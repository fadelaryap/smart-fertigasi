from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from math import exp

import numpy as np

try:
    import skfuzzy as fuzz
    from skfuzzy import control as ctrl
except ImportError as exc:  # pragma: no cover
    raise ImportError(
        "Missing dependency 'scikit-fuzzy'. Install with: pip install -r requirements.txt"
    ) from exc


@dataclass
class FuzzyConfig:
    # Soil moisture ranges
    sdmin: float = 16.0
    snmin: float = 20.0
    sdmax: float = 24.0
    swmin: float = 25.0
    snmax: float = 28.0
    swmax: float = 30.0

    # ET0 ranges (per hour, in mm/hour)
    elmin: float = 0.0
    emmin: float = 0.1
    elmax: float = 0.25
    ehmin: float = 0.35
    emmax: float = 0.6
    ehmax: float = 1.0

    # Output duration ranges (minutes)
    os: float = 5.0
    om: float = 15.0
    ol: float = 30.0
    output_max: float = 60.0


class FuzzyIrrigationController:
    def __init__(self, cfg: Optional[FuzzyConfig] = None) -> None:
        self.cfg = cfg or FuzzyConfig()
        self._system: Optional[ctrl.ControlSystem] = None
        self._simulation: Optional[ctrl.ControlSystemSimulation] = None
        self.build_fuzzy()

    def build_fuzzy(self) -> None:
        cfg = self.cfg

        # Universes
        soil_universe = np.arange(cfg.sdmin, cfg.swmax + 0.1, 0.1)
        et0_universe = np.arange(cfg.elmin, cfg.ehmax + 0.1, 0.1)
        duration_universe = np.arange(0, cfg.output_max + 1, 1)

        # INPUT 1: Soil Moisture
        sm = ctrl.Antecedent(soil_universe, "soil_moisture")
        sm["dry"] = fuzz.trapmf(soil_universe, [cfg.sdmin, cfg.sdmin, cfg.snmin, cfg.sdmax])
        sm["norm"] = fuzz.trapmf(soil_universe, [cfg.snmin, cfg.sdmax, cfg.swmin, cfg.snmax])
        sm["wet"] = fuzz.trapmf(soil_universe, [cfg.swmin, cfg.snmax, cfg.swmax, cfg.swmax])

        # INPUT 2: ET0 (per hour)
        et0 = ctrl.Antecedent(et0_universe, "et0")
        et0["low"] = fuzz.trapmf(et0_universe, [cfg.elmin, cfg.elmin, cfg.emmin, cfg.elmax])
        et0["med"] = fuzz.trapmf(et0_universe, [cfg.emmin, cfg.elmax, cfg.ehmin, cfg.emmax])
        et0["high"] = fuzz.trapmf(et0_universe, [cfg.ehmin, cfg.emmax, cfg.ehmax, cfg.ehmax])

        # OUTPUT: watering duration
        dur = ctrl.Consequent(duration_universe, "watering_minutes")
        dur["off"] = fuzz.trapmf(duration_universe, [0, 0, 0.5, 1])
        dur["short"] = fuzz.trapmf(duration_universe, [0, 0, cfg.os, cfg.os + 2])
        dur["medium"] = fuzz.trapmf(duration_universe, [cfg.os, cfg.om, cfg.om, cfg.om + 2])
        dur["long"] = fuzz.trapmf(duration_universe, [cfg.om, cfg.ol, cfg.ol, cfg.output_max])

        # RULES (9 RULES MATRIX)
        rules = [
            ctrl.Rule(sm["dry"] & et0["high"], dur["long"]),
            ctrl.Rule(sm["dry"] & et0["med"], dur["long"]),
            ctrl.Rule(sm["dry"] & et0["low"], dur["medium"]),
            ctrl.Rule(sm["norm"] & et0["high"], dur["medium"]),
            ctrl.Rule(sm["norm"] & et0["med"], dur["short"]),
            ctrl.Rule(sm["norm"] & et0["low"], dur["short"]),
            ctrl.Rule(sm["wet"] & et0["high"], dur["off"]),
            ctrl.Rule(sm["wet"] & et0["med"], dur["off"]),
            ctrl.Rule(sm["wet"] & et0["low"], dur["off"]),
        ]

        system = ctrl.ControlSystem(rules)
        self._system = system
        self._simulation = ctrl.ControlSystemSimulation(system)

    @staticmethod
    def calc_et0(t: float, rh: float, w: float, r: float) -> float:
        """Calculate hourly ET0 using simplified Penman-Monteith equation."""
        u2 = w * 0.748
        es = 0.6108 * exp((17.27 * t) / (t + 237.3))
        ea = (rh / 100.0) * es
        vd = es - ea
        rn = r * 0.0036
        g = 0.0
        delta = (4098.0 * es) / ((t + 237.3) * (t + 237.3))
        gamma = 0.665e-3 * 101.3

        numerator = (0.408 * delta * (rn - g)) + (gamma * (37.0 / (t + 273.0)) * u2 * vd)
        denominator = delta + (gamma * (1.0 + 0.34 * u2))
        et0 = numerator / denominator if denominator != 0 else 0.0
        return max(et0, 0.0)

    def compute(
            self,
            soil_moisture: float,
            temperature: float,
            relative_humidity: float,
            wind_speed: float,
            solar_radiation: float,
    ) -> float:
        if self._simulation is None:
            raise RuntimeError("Fuzzy controller is not initialized.")

        # Calculate ET0 per hour from sensor inputs
        et0_hourly = self.calc_et0(temperature, relative_humidity, wind_speed, solar_radiation)

        # FIX: Amankan nilai input agar berada di dalam rentang semesta pembicaraan
        soil_moisture_safe = float(np.clip(soil_moisture, self.cfg.sdmin, self.cfg.swmax))
        et0_safe = float(np.clip(et0_hourly, self.cfg.elmin, self.cfg.ehmax))

        # Set fuzzy inputs safely
        self._simulation.input["soil_moisture"] = soil_moisture_safe
        self._simulation.input["et0"] = et0_safe

        # Compute fuzzy inference
        self._simulation.compute()

        raw_duration = float(self._simulation.output["watering_minutes"])

        # Saringan akhir untuk memastikan status "OFF" bernilai murni 0.0 menit
        return raw_duration if raw_duration >= 1.0 else 0.0


def build_fuzzy(cfg: Optional[FuzzyConfig] = None) -> FuzzyIrrigationController:
    """Create and return a FuzzyIrrigationController instance."""
    return FuzzyIrrigationController(cfg)


if __name__ == "__main__":
    controller = build_fuzzy()

    # Test samples: (soil_moisture, temp_C, RH_%, wind_m/s, radiation_W/m2)
    samples = [
        # Scenario 1: dry soil, hot & sunny
        (15, 32, 40, 2.5, 800),
        # Scenario 2: normal soil, moderate conditions
        (22, 25, 65, 1.5, 600),
        # Scenario 3: wet soil, cool & cloudy
        (29, 18, 85, 0.8, 200),
        # Scenario 4: dry soil, cool but clear
        (17, 20, 70, 1.2, 700),
    ]

    print("Fuzzy Irrigation Controller - Hourly ET0 Calculation")
    print("=" * 80)
    print(
        f"{'Soil':>6} | {'Temp':>5} | {'RH':>4} | {'Wind':>5} | {'Rad':>5} | "
        f"{'ET0/h':>6} | {'Water':>6}"
    )
    print(
        f"{'(%)':>6} | {'(°C)':>5} | {'(%)':>4} | {'(m/s)':>5} | {'(W/m²)':>5} | "
        f"{'(mm/h)':>6} | {'(min)':>6}"
    )
    print("-" * 80)

    for soil, temp, rh, wind, rad in samples:
        et0 = controller.calc_et0(temp, rh, wind, rad)
        minutes = controller.compute(soil, temp, rh, wind, rad)
        print(
            f"{soil:>6.1f} | {temp:>5.1f} | {rh:>4.1f} | {wind:>5.2f} | {rad:>5.1f} | "
            f"{et0:>6.3f} | {minutes:>6.2f}"
        )
    print("=" * 80)
