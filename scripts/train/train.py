"""
Offline training. Reads data/train/*.csv (written by scripts/generate-seed.ts) and writes
data/models.json — coefficients only. The browser runs inference in TypeScript (lib/ml/*).

    python3 scripts/train/train.py

Models
  1. Demand forecast      ridge regression on scale-free engineered features (exported)
                          + HistGradientBoosting trained on identical features (reported only)
  2. Price elasticity     Poisson log-link (log-log) regression per category/price-band cluster,
                          with sale-event fixed effects
  3. RTO risk             logistic regression (one-hot)
  4. Anomaly thresholds   rolling z-score stats + 1-D IsolationForest decision boundaries
"""
import json
import math
import os
import sys

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingRegressor, IsolationForest
from sklearn.linear_model import LogisticRegression, PoissonRegressor, Ridge
from sklearn.metrics import brier_score_loss, roc_auc_score

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
TRAIN = os.path.join(ROOT, "data", "train")
OUT = os.path.join(ROOT, "data", "models.json")
RNG = 7
HOLDOUT_DAYS = 90

if not os.path.exists(os.path.join(TRAIN, "sku_daily.csv")):
    sys.exit("data/train missing — run `npm run seed` first")


def r(x, n=5):
    return float(round(float(x), n))


# ------------------------------------------------------------------ 1. demand forecast
df = pd.read_csv(os.path.join(TRAIN, "sku_daily.csv"))
df = df.sort_values(["sku", "t"]).reset_index(drop=True)
g = df.groupby("sku", group_keys=False)

df["scale"] = g["units"].transform(lambda s: s.shift(1).rolling(28, min_periods=28).mean()) + 0.5
for lag in (1, 7, 14, 28):
    df[f"lag{lag}"] = g["units"].shift(lag)
df["roll7"] = g["units"].transform(lambda s: s.shift(1).rolling(7).mean())
df["roll7std"] = g["units"].transform(lambda s: s.shift(1).rolling(7).std())
df["roll28"] = df["scale"] - 0.5
df["price30"] = g["price"].transform(lambda s: s.shift(1).rolling(30, min_periods=7).mean())
df = df.dropna().reset_index(drop=True)

FEATURES = [
    "lag1", "lag7", "lag14", "lag28", "roll7", "roll7std",
    "dow_1", "dow_2", "dow_3", "dow_4", "dow_5", "dow_6",
    "festival", "promo", "log_price_ratio",
    "fest_apparel", "fest_electronics", "fest_home", "fest_personal_care",
]


def build_x(d):
    X = pd.DataFrame(index=d.index)
    for c in ("lag1", "lag7", "lag14", "lag28", "roll7", "roll7std"):
        X[c] = d[c] / d["scale"]
    for k in range(1, 7):
        X[f"dow_{k}"] = (d["dow"] == k).astype(float)
    X["festival"] = d["festival"].astype(float)
    X["promo"] = d["promo"].astype(float)
    X["log_price_ratio"] = np.log(d["price"] / d["price30"])
    for cat in ("apparel", "electronics", "home", "personal_care"):
        X[f"fest_{cat}"] = d["festival"] * (d["category"] == cat)
    return X[FEATURES].astype(float)


X = build_x(df)
y = df["units"] / df["scale"]
cut = df["t"].max() - HOLDOUT_DAYS
tr, te = df["t"] <= cut, df["t"] > cut

ridge = Ridge(alpha=1.0).fit(X[tr], y[tr])
pred_ridge = np.clip(ridge.predict(X[te]), 0, None) * df.loc[te, "scale"]
gbm = HistGradientBoostingRegressor(max_iter=300, learning_rate=0.06, max_leaf_nodes=31, random_state=RNG).fit(X[tr], y[tr])
pred_gbm = np.clip(gbm.predict(X[te]), 0, None) * df.loc[te, "scale"]

act = df.loc[te, "units"].values


def mape(pred):
    m = act > 0
    return float(np.mean(np.abs(act[m] - np.asarray(pred)[m]) / act[m]))


def wape(pred):
    return float(np.sum(np.abs(act - np.asarray(pred))) / np.sum(act))


baselines = {
    "naive_lag1": df.loc[te, "lag1"].values,
    "seasonal_naive_lag7": df.loc[te, "lag7"].values,
    "moving_avg_7": df.loc[te, "roll7"].values,
    "moving_avg_28": df.loc[te, "roll28"].values,
}
metrics = {
    name: {"mape": r(mape(p), 4), "wape": r(wape(p), 4)}
    for name, p in [("ridge_exported", pred_ridge), ("gbm_reference", pred_gbm), *baselines.items()]
}
# festival-only slice, where baselines fail hardest
fest_mask = df.loc[te, "festival"].values == 1
if fest_mask.sum() > 0:
    def wape_mask(pred, m):
        return float(np.sum(np.abs(act[m] - np.asarray(pred)[m])) / max(1, np.sum(act[m])))
    metrics["festival_days_wape"] = {
        "ridge_exported": r(wape_mask(pred_ridge, fest_mask), 4),
        "moving_avg_7": r(wape_mask(baselines["moving_avg_7"], fest_mask), 4),
        "naive_lag1": r(wape_mask(baselines["naive_lag1"], fest_mask), 4),
    }

# residual model for safety stock: sigma(yhat) = a * yhat^b fitted on training residuals
pred_tr = np.clip(ridge.predict(X[tr]), 0, None) * df.loc[tr, "scale"]
res_tr = df.loc[tr, "units"].values - pred_tr
mask = pred_tr > 0.3
b, log_a = np.polyfit(np.log(pred_tr[mask]), np.log(np.abs(res_tr[mask]) + 0.25), 1)
sigma_a = float(math.exp(log_a) * math.sqrt(math.pi / 2))  # E|e| -> sigma for a normal
rel = res_tr[mask] / np.maximum(pred_tr[mask], 1)
qs = [0.5, 0.8, 0.85, 0.9, 0.95, 0.975, 0.99]

hourly = pd.read_csv(os.path.join(TRAIN, "hourly.csv"))
hour_curve = hourly.groupby("hour")["orders"].sum()
hour_curve = (hour_curve / hour_curve.sum()).reindex(range(24), fill_value=0)

forecast_export = {
    "type": "ridge",
    "target": "units / (rolling28_mean + 0.5)",
    "features": FEATURES,
    "coef": [r(c, 6) for c in ridge.coef_],
    "intercept": r(ridge.intercept_, 6),
    "sigma": {"a": r(sigma_a, 4), "b": r(b, 4)},
    "relErrorQuantiles": {str(q): r(np.quantile(rel, q), 4) for q in qs},
    "hourCurve": [r(v, 5) for v in hour_curve.values],
    "holdoutDays": HOLDOUT_DAYS,
    "metrics": metrics,
}

# ------------------------------------------------------------------ 2. price elasticity
elasticity = {}
truth = pd.read_json(os.path.join(ROOT, "data", "seed.json"), typ="series")["catalog"]
true_by_cluster = {}
for p in truth:
    true_by_cluster.setdefault(p["cluster"], []).append(p["elasticity"])
for cluster, d in df.groupby("cluster"):
    Z = pd.DataFrame({
        "log_price_ratio": np.log(d["price"] / d["base_price"]),
        "log_level": np.log(d["scale"]),
    })
    # event fixed effects: each sale has its own unobserved intent, which is correlated with its discount depth
    for ev in sorted(e for e in d["event"].unique() if e != "none"):
        Z[f"event_{ev}"] = (d["event"] == ev).astype(float)
    for k in range(1, 7):
        Z[f"dow_{k}"] = (d["dow"] == k).astype(float)
    m = PoissonRegressor(alpha=0, max_iter=5000, tol=1e-8).fit(Z, d["units"])
    elasticity[cluster] = {
        "slope": r(m.coef_[0], 4),
        "intercept": r(m.intercept_, 4),
        "n": int(len(d)),
        "trueMean": r(np.mean(true_by_cluster.get(cluster, [np.nan])), 4),
    }

# ------------------------------------------------------------------ 3. RTO classifier
o = pd.read_csv(os.path.join(TRAIN, "orders_rto.csv"))
RTO_FEATURES = [
    "cod", "tier2", "tier3", "log_value",
    "cat_electronics", "cat_home", "cat_personal_care",
    "courier_CR-KAVERI", "courier_CR-NORTHSTAR", "courier_CR-DAKSHIN",
    "cart_size", "first_time",
]
LOG_VALUE_REF = float(np.log(1000))


def rto_x(d):
    Z = pd.DataFrame(index=d.index)
    Z["cod"] = (d["payment_mode"] == "cod").astype(float)
    Z["tier2"] = (d["tier"] == "tier2").astype(float)
    Z["tier3"] = (d["tier"] == "tier3").astype(float)
    Z["log_value"] = np.log(d["order_value"].clip(lower=100)) - LOG_VALUE_REF
    for c in ("electronics", "home", "personal_care"):
        Z[f"cat_{c}"] = (d["category"] == c).astype(float)
    for c in ("CR-KAVERI", "CR-NORTHSTAR", "CR-DAKSHIN"):
        Z[f"courier_{c}"] = (d["courier_id"] == c).astype(float)
    Z["cart_size"] = d["cart_size"].astype(float)
    Z["first_time"] = d["first_time"].astype(float)
    return Z[RTO_FEATURES]


Zo = rto_x(o)
n_tr = int(len(o) * 0.8)
clf = LogisticRegression(C=10.0, max_iter=2000).fit(Zo.iloc[:n_tr], o["rto"].iloc[:n_tr])
p_te = clf.predict_proba(Zo.iloc[n_tr:])[:, 1]
y_te = o["rto"].iloc[n_tr:]
cod_only = o.iloc[n_tr:]["payment_mode"] == "cod"
rto_export = {
    "features": RTO_FEATURES,
    "weights": {f: r(w, 5) for f, w in zip(RTO_FEATURES, clf.coef_[0])},
    "intercept": r(clf.intercept_[0], 5),
    "logValueRef": r(LOG_VALUE_REF, 5),
    "reference": "metro, prepaid, apparel, Vayu Express, ₹1,000, repeat customer",
    "metrics": {
        "auc": r(roc_auc_score(y_te, p_te), 4),
        "brier": r(brier_score_loss(y_te, p_te), 4),
        "base_rate": r(y_te.mean(), 4),
        "cod_rto_rate": r(y_te[cod_only].mean(), 4),
        "prepaid_rto_rate": r(y_te[~cod_only].mean(), 4),
        "n_train": n_tr,
        "n_test": int(len(o) - n_tr),
    },
}

# ------------------------------------------------------------------ 4. anomaly thresholds


def iso_bounds(values, contamination=0.01):
    v = np.asarray(values, dtype=float).reshape(-1, 1)
    forest = IsolationForest(n_estimators=200, contamination=contamination, random_state=RNG).fit(v)
    grid = np.linspace(np.quantile(v, 0.0005), np.quantile(v, 0.9995), 800).reshape(-1, 1)
    inlier = forest.predict(grid) == 1
    if not inlier.any():
        return None
    return {"low": r(grid[inlier].min()), "high": r(grid[inlier].max())}


def stats(values):
    v = np.asarray(values, dtype=float)
    return {
        "mean": r(v.mean()), "std": r(v.std()),
        "p95": r(np.quantile(v, 0.95)), "p99": r(np.quantile(v, 0.99)), "p999": r(np.quantile(v, 0.999)),
    }


vel = df[(df["festival"] == 0) & (df["roll28"] >= 2)]
vel_ratio = (vel["units"] / vel["roll28"]).values
sla = pd.read_csv(os.path.join(TRAIN, "courier_sla.csv"))
lead = pd.read_csv(os.path.join(TRAIN, "supplier_lead.csv"))

anomaly_export = {
    "velocityRatio": {**stats(vel_ratio), "isolationForest": iso_bounds(vel_ratio)},
    "courierSlaRatio": {
        cid: {**stats(d["ratio"]), "isolationForest": iso_bounds(d["ratio"])}
        for cid, d in sla.groupby("courier_id")
    },
    "supplierLeadDeviation": {**stats(lead["deviation"]), "isolationForest": iso_bounds(lead["deviation"])},
    "zScore": {"warn": 3.0, "critical": 4.5},
    "note": "1-D IsolationForest (contamination 1%) decision boundaries exported as inlier ranges; runtime compares raw values to these bounds and to rolling z-scores.",
}

models = {
    "version": 1,
    "forecast": forecast_export,
    "elasticity": elasticity,
    "rto": rto_export,
    "anomaly": anomaly_export,
}
with open(OUT, "w") as f:
    json.dump(models, f, indent=1)

print("forecast metrics:")
for k, v in metrics.items():
    print(f"  {k:24s} {v}")
print("elasticity (fitted vs true mean):")
for k, v in sorted(elasticity.items()):
    print(f"  {k:24s} fitted={v['slope']:+.3f} true={v['trueMean']:+.3f}")
print("rto:", rto_export["metrics"])
print("anomaly velocity:", anomaly_export["velocityRatio"])
print(f"wrote {OUT}")
