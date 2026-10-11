from fastapi import FastAPI, HTTPException

from tsp_app.models import TSPRequest
from tsp_app.classical import solve_tsp_classical

app = FastAPI(
    title="TSP Solver",
    version="0.1.0"
)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/tsp/classical")
def classical_tsp(req: TSPRequest):
    try:
        return solve_tsp_classical(req.distances)

    except ValueError as exc:
        raise HTTPException(
            status_code=422,
            detail=str(exc)
        ) from exc
