from __future__ import annotations

import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

_BACKEND_DIR = Path(__file__).resolve().parent
_ENV_FILE = _BACKEND_DIR / ".env"
load_dotenv(_ENV_FILE)
load_dotenv()
if not os.getenv("OPENAI_API_KEY", "").strip():
    load_dotenv(_ENV_FILE, override=True)

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from agent.graph import run_idea_workflow
from idea_store import get_idea, get_run, save_run
from schemas import GenerateIdeasRequest, GenerateIdeasResponse, HealthResponse, TourIdea

DEFAULT_ORIGINS = [
    "https://perfect-picture-pal-beige.vercel.app",
    "http://localhost:5173",
    "http://localhost:8080",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:8080",
]


def cors_origins() -> list[str]:
    extra = os.getenv("CORS_ORIGINS", "")
    values = [item.strip() for item in extra.split(",") if item.strip()]
    return list(dict.fromkeys([*DEFAULT_ORIGINS, *values]))


def _log_openai_key_status() -> None:
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        print("❌ WARNING: OPENAI_API_KEY is not found in environment!")
    else:
        print(f"✅ OPENAI_API_KEY loaded successfully: {api_key[:5]}...")


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    _log_openai_key_status()
    yield


app = FastAPI(
    title="Արի Գնանք Idea Agent",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins(),
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def health_check() -> dict[str, str]:
    return {"status": "ok", "message": "Backend is running"}


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
        stored = save_run(body.model_dump(), [item.model_dump() for item in parsed], summary)
        return GenerateIdeasResponse(
            run_id=str(stored["id"]),
            ideas=parsed,
            research_summary=summary,
        )
    except HTTPException:
        raise
    except ValidationError as error:
        raise HTTPException(status_code=502, detail=f"Idea schema failed validation: {error}") from error
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error
    except Exception as error:
        raise HTTPException(status_code=500, detail="Tour idea generation failed.") from error


@app.get("/api/idea-runs/{run_id}", response_model=GenerateIdeasResponse)
def read_idea_run(run_id: str) -> GenerateIdeasResponse:
    record = get_run(run_id)
    if not record:
        raise HTTPException(status_code=404, detail="Idea run not found.")
    ideas = [TourIdea.model_validate(item) for item in record.get("ideas") or []]
    return GenerateIdeasResponse(
        run_id=str(record.get("id") or run_id),
        ideas=ideas,
        research_summary=str(record.get("research_summary") or ""),
    )


@app.get("/api/ideas/{idea_id}", response_model=TourIdea)
def read_idea(idea_id: str) -> TourIdea:
    record = get_idea(idea_id)
    if not record:
        raise HTTPException(status_code=404, detail="Idea not found.")
    return TourIdea.model_validate(record)
