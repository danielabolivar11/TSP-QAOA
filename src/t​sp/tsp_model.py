from pydantic import BaseModel, Field

class TSPRequest(BaseModel):
    distances: list[list[float]] = Field(
        description="Matriz de costos entre ciudades"
    )
