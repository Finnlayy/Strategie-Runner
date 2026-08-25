"""
Differential Evolution & Multi-Objective Fitness Engine (Modul 4: 04_ACADEMY_DIFFERENTIAL_EVO).
Implements continuous DE/rand/1/bin and DE/best/2/bin algorithms with adaptive mutation (F),
crossover (CR), stagnation restarts, and Pareto-efficient multi-objective selection.
"""

from dataclasses import dataclass
import math
import random
import time
from typing import Any, Callable, Dict, List, Optional, Tuple

import numpy as np

from app.core.directives import ExecutionPath, system_directive


@dataclass
class GenomeBounds:
    param_names: List[str]
    lower_bounds: np.ndarray
    upper_bounds: np.ndarray


@dataclass
class Individual:
    vector: np.ndarray
    fitness: float = -1e9
    metrics: Dict[str, float] = None
    generation: int = 0


class DifferentialEvolutionOptimizer:
    """
    Continuous Differential Evolution Optimizer for Algorithmic Strategy Parameters.
    """

    def __init__(
        self,
        bounds: Dict[str, Tuple[float, float]],
        population_size: int = 30,
        mutation_factor: float = 0.7,      # F in [0.4, 0.9]
        crossover_prob: float = 0.8,       # CR in [0.1, 0.9]
        max_generations: int = 40,
        stagnation_limit: int = 8,
        strategy: str = "rand1bin"          # "rand1bin" or "best2bin"
    ):
        self.param_names = list(bounds.keys())
        self.lower_bounds = np.array([bounds[k][0] for k in self.param_names], dtype=np.float64)
        self.upper_bounds = np.array([bounds[k][1] for k in self.param_names], dtype=np.float64)
        self.dimensions = len(self.param_names)
        self.pop_size = max(population_size, 4)
        self.F = mutation_factor
        self.CR = crossover_prob
        self.max_generations = max_generations
        self.stagnation_limit = stagnation_limit
        self.strategy = strategy

    def optimize(
        self,
        fitness_fn: Callable[[Dict[str, float]], Tuple[float, Dict[str, float]]]
    ) -> Dict[str, Any]:
        """
        Executes continuous Differential Evolution loop.

        Args:
            fitness_fn: Function mapping parameter dictionary -> (scalar_fitness, metrics_dict).

        Returns:
            Optimization run summary with best genome, convergence history, and stagnation status.
        """
        system_directive.record_path_execution(ExecutionPath.COLD_PATH)
        start_time = time.perf_counter()

        # 1. Initialize random population within bounds
        population: List[Individual] = []
        for _ in range(self.pop_size):
            vec = self.lower_bounds + np.random.rand(self.dimensions) * (self.upper_bounds - self.lower_bounds)
            p_dict = {name: float(vec[idx]) for idx, name in enumerate(self.param_names)}
            fit, metrics = fitness_fn(p_dict)
            population.append(Individual(vector=vec, fitness=fit, metrics=metrics, generation=0))

        # Find initial best
        best_ind = max(population, key=lambda ind: ind.fitness)
        history: List[Dict[str, Any]] = [{
            "generation": 0,
            "best_fitness": round(best_ind.fitness, 4),
            "mean_fitness": round(float(np.mean([ind.fitness for ind in population])), 4)
        }]

        stagnant_gens = 0
        current_F = self.F
        current_CR = self.CR

        # 2. Generational Evolution Loop
        for g in range(1, self.max_generations + 1):
            improved = False

            # Sort or extract best individual for best2bin
            best_in_pop = max(population, key=lambda ind: ind.fitness)

            for i in range(self.pop_size):
                target = population[i]

                # Select 3 distinct random candidates != i
                idxs = [j for j in range(self.pop_size) if j != i]
                r1, r2, r3 = random.sample(idxs, 3)

                # Mutation
                if self.strategy == "best2bin" and len(idxs) >= 4:
                    r4 = random.sample([j for j in idxs if j not in (r1, r2, r3)], 1)[0]
                    mutant = best_in_pop.vector + current_F * (population[r1].vector - population[r2].vector) + current_F * (population[r3].vector - population[r4].vector)
                else:
                    mutant = population[r1].vector + current_F * (population[r2].vector - population[r3].vector)

                # Crossover (Binomial)
                trial = np.copy(target.vector)
                rand_j = random.randint(0, self.dimensions - 1)
                for j in range(self.dimensions):
                    if random.random() < current_CR or j == rand_j:
                        trial[j] = mutant[j]

                # Bound handling (Reflection / Clamping)
                trial = np.clip(trial, self.lower_bounds, self.upper_bounds)

                # Evaluation
                trial_dict = {name: float(trial[idx]) for idx, name in enumerate(self.param_names)}
                trial_fit, trial_metrics = fitness_fn(trial_dict)

                # Selection
                if trial_fit >= target.fitness:
                    population[i] = Individual(vector=trial, fitness=trial_fit, metrics=trial_metrics, generation=g)
                    if trial_fit > best_ind.fitness:
                        best_ind = population[i]
                        improved = True

            # Stagnation tracking & adaptive hyperparameter perturbation
            if improved:
                stagnant_gens = 0
                current_F = self.F
            else:
                stagnant_gens += 1
                # Adaptive mutation boost to escape local minima
                current_F = min(0.95, current_F + 0.05)
                current_CR = max(0.2, current_CR - 0.05)

            # Island Stagnation Restart
            if stagnant_gens >= self.stagnation_limit:
                # Re-seed worst 30% of population
                k_worst = max(1, int(self.pop_size * 0.3))
                sorted_pop = sorted(population, key=lambda ind: ind.fitness)
                for idx in range(k_worst):
                    new_vec = self.lower_bounds + np.random.rand(self.dimensions) * (self.upper_bounds - self.lower_bounds)
                    p_dict = {name: float(new_vec[j]) for j, name in enumerate(self.param_names)}
                    n_fit, n_metrics = fitness_fn(p_dict)
                    sorted_pop[idx] = Individual(vector=new_vec, fitness=n_fit, metrics=n_metrics, generation=g)
                population = sorted_pop
                stagnant_gens = 0

            history.append({
                "generation": g,
                "best_fitness": round(best_ind.fitness, 4),
                "mean_fitness": round(float(np.mean([ind.fitness for ind in population])), 4),
                "stagnant_count": stagnant_gens
            })

        duration = time.perf_counter() - start_time
        best_params = {name: round(float(best_ind.vector[idx]), 6) for idx, name in enumerate(self.param_names)}

        return {
            "best_params": best_params,
            "best_fitness": round(best_ind.fitness, 4),
            "best_metrics": best_ind.metrics or {},
            "generations_completed": self.max_generations,
            "population_size": self.pop_size,
            "duration_sec": round(duration, 2),
            "history": history
        }
