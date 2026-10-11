import math
from itertools import permutations


def solve_tsp_classical(distances: list[list[float]]) -> dict:
    n = len(distances)

    if not 3 <= n <= 9:
        raise ValueError("Se admiten entre 3 y 9 ciudades")

    if any(len(row) != n for row in distances):
        raise ValueError("La matriz debe ser cuadrada")

    if any(
        not math.isfinite(d) or d < 0
        for row in distances
        for d in row
    ):
        raise ValueError("Los costos deben ser finitos y no negativos")

    if any(distances[i][i] != 0 for i in range(n)):
        raise ValueError("La diagonal debe contener ceros")

    best_cost = math.inf
    best_route = []

    # Fijamos la ciudad 0 como origen.
    for perm in permutations(range(1, n)):
        route = [0, *perm, 0]

        cost = sum(
            distances[route[i]][route[i + 1]]
            for i in range(n)
        )

        if cost < best_cost:
            best_cost = cost
            best_route = route

    return {
        "algorithm": "brute_force",
        "route": best_route,
        "cost": best_cost
    }
