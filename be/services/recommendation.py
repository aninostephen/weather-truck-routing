"""Route risk aggregation and lexicographical recommendation ranking."""

from typing import Any

from common.constants import (
    RISK_HIGH,
    RISK_LEVELS,
    RISK_NO_TRAVEL,
    RISK_SCORES,
    RISK_SEVERE,
    SCORE_TO_RISK,
)


def summarize_route_risk(
    checkpoints: list[dict[str, Any]],
    total_distance_miles: float,
) -> dict[str, Any]:
    """Aggregate miles per risk tier, overall worst risk, and distance-weighted average risk."""
    miles_by_risk: dict[str, float] = {level: 0.0 for level in RISK_LEVELS}
    checkpoint_counts: dict[str, int] = {level: 0 for level in RISK_LEVELS}

    weighted_score_sum = 0.0
    segment_miles_sum = 0.0
    max_risk_score = 0

    for cp in checkpoints:
        level = cp["risk_level"]
        score = int(cp.get("risk_score", RISK_SCORES[level]))
        seg_miles = float(cp.get("segment_miles", 0.0))

        miles_by_risk[level] += seg_miles
        checkpoint_counts[level] += 1
        weighted_score_sum += score * seg_miles
        segment_miles_sum += seg_miles
        if score > max_risk_score:
            max_risk_score = score

    if segment_miles_sum > 1e-6:
        average_risk = weighted_score_sum / segment_miles_sum
    elif checkpoints:
        average_risk = sum(int(cp["risk_score"]) for cp in checkpoints) / len(checkpoints)
    else:
        average_risk = 0.0

    rounded_miles = {level: round(miles, 2) for level, miles in miles_by_risk.items()}

    return {
        "overall_risk_level": SCORE_TO_RISK[max_risk_score],
        "max_risk_score": max_risk_score,
        "average_risk": round(average_risk, 3),
        "no_travel_miles": rounded_miles[RISK_NO_TRAVEL],
        "severe_miles": rounded_miles[RISK_SEVERE],
        "high_miles": rounded_miles[RISK_HIGH],
        "miles_by_risk": rounded_miles,
        "checkpoint_counts": checkpoint_counts,
        "has_no_travel": rounded_miles[RISK_NO_TRAVEL] > 0.0,
        "total_distance_miles": round(total_distance_miles, 2),
    }


def route_sort_key(route: dict[str, Any]) -> tuple[float, float, float, float, float]:
    """
    Lexicographical preference tuple (smaller is better):
      0. Fewest No Travel miles
      1. Fewest Severe miles
      2. Fewest High miles
      3. Lowest average risk
      4. Shortest travel time (seconds)
    """
    risk = route["risk_summary"]
    return (
        round(float(risk["no_travel_miles"]), 2),
        round(float(risk["severe_miles"]), 2),
        round(float(risk["high_miles"]), 2),
        round(float(risk["average_risk"]), 3),
        round(float(route["duration_seconds"]), 1),
    )


def select_recommended_route(routes: list[dict[str, Any]]) -> tuple[str | None, str, bool]:
    """
    Rank analyzed routes, mark `is_recommended` & `rank` on each route in-place,
    and return `(recommended_route_id, recommendation_reason, has_no_travel_advisory)`.
    """
    if not routes:
        return None, "No routes available.", False

    ranked = sorted(routes, key=route_sort_key)
    winner = ranked[0]
    winner_id = winner["id"]

    for rank_idx, route in enumerate(ranked, start=1):
        route["rank"] = rank_idx
        route["is_recommended"] = route["id"] == winner_id

    winner_risk = winner["risk_summary"]
    has_advisory = bool(winner_risk["has_no_travel"])
    reason = _build_recommendation_reason(winner, ranked[1:], has_advisory)
    return winner_id, reason, has_advisory


def _build_recommendation_reason(
    winner: dict[str, Any],
    runners_up: list[dict[str, Any]],
    has_advisory: bool,
) -> str:
    """Create a concise, human-readable explanation of why the winner won."""
    w_risk = winner["risk_summary"]
    label = winner.get("name", "Recommended route")

    if not runners_up:
        if has_advisory:
            return f"{label} is the only available truck route, but contains No Travel weather conditions."
        return f"{label} selected as the optimal route."

    second_risk = runners_up[0]["risk_summary"]
    reasons: list[str] = []

    if w_risk["no_travel_miles"] < second_risk["no_travel_miles"]:
        if w_risk["no_travel_miles"] == 0:
            reasons.append("avoids No Travel conditions")
        else:
            reasons.append(f"minimizes No Travel exposure ({w_risk['no_travel_miles']} mi)")

    if w_risk["severe_miles"] < second_risk["severe_miles"]:
        if w_risk["severe_miles"] == 0:
            reasons.append("has 0 Severe weather miles")
        else:
            reasons.append(f"has the fewest Severe miles ({w_risk['severe_miles']} mi)")
    elif w_risk["severe_miles"] == 0:
        reasons.append("avoids Severe weather")

    if w_risk["high_miles"] < second_risk["high_miles"]:
        reasons.append(f"fewer High-risk miles ({w_risk['high_miles']} mi)")

    if not reasons or w_risk["average_risk"] < second_risk["average_risk"]:
        reasons.append(f"lowest average risk ({w_risk['average_risk']:.2f})")

    if (
        w_risk["no_travel_miles"] == second_risk["no_travel_miles"]
        and w_risk["severe_miles"] == second_risk["severe_miles"]
        and w_risk["high_miles"] == second_risk["high_miles"]
        and w_risk["average_risk"] == second_risk["average_risk"]
    ):
        mins_saved = max(0, round((runners_up[0]["duration_seconds"] - winner["duration_seconds"]) / 60))
        if mins_saved > 0:
            reasons.append(f"saves {mins_saved} min of travel time")
        else:
            reasons.append("shortest travel time")

    prefix = (
        "No Travel Advisory: All routes encounter extreme weather; "
        f"{label} is the least hazardous option because it "
        if has_advisory
        else f"{label} recommended: "
    )
    return prefix + ", ".join(reasons[:3]) + "."

