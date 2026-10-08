from __future__ import annotations

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from agent.graph import run_idea_workflow
from schemas import GenerateIdeasRequest, GenerateIdeasResponse, HealthResponse, TourIdea

load_dotenv()

DEFAULT_ORIGINS = [
    "https://perfect-picture-pal-beige.vercel.app",
    "http://localhost:5173",
    "http://localhost:8080",
]


def cors_origins() -> list[str]:
    extra = os.getenv("CORS_ORIGINS", "")
    values = [item.strip() for item in extra.split(",") if item.strip()]
    merged = list(dict.fromkeys([*DEFAULT_ORIGINS, *values]))
    return merged


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    yield


app = FastAPI(
    title="Արի Գնանք Idea Agent",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/api/generate-ideas", response_model=GenerateIdeasResponse)
def generate_ideas(body: GenerateIdeasRequest) -> GenerateIdeasResponse:
    if not os.getenv("OPENAI_API_KEY", "").strip():
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured.")
    try:
        ideas, summary = run_idea_workflow(body)
        parsed = [TourIdea.model_validate(item) for item in ideas]
        return GenerateIdeasResponse(ideas=parsed, research_summary=summary)
    except HTTPException:
        raise
    except ValidationError as error:
        raise HTTPException(status_code=502, detail=f"Idea schema failed validation: {error}") from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="Tour idea generation failed.") from error
