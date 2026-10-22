from __future__ import annotations

import hmac
import os
import sys
import time
from collections import defaultdict, deque
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import UUID

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

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import ValidationError

from agent.graph import run_idea_workflow
from idea_store import get_run, save_run
from schemas import GenerateIdeasRequest, GenerateIdeasResponse, HealthResponse, TourIdea

GENERATE_RATE_LIMIT = 5
GENERATE_RATE_WINDOW_SEC = 60
_generate_hits: dict[str, deque[float]] = defaultdict(deque)


def _ideas_api_secret() -> str:
    return os.getenv("IDEAS_API_SECRET", "").strip()


def cors_origins() -> list[str]:
    extra = os.getenv("CORS_ORIGINS", "")
    return [item.strip() for item in extra.split(",") if item.strip()]


def _log_openai_key_status() -> None:
    configured = bool(os.getenv("OPENAI_API_KEY", "").strip())
    print(f"OPENAI_API_KEY configured: {str(configured).lower()}")


def _secret_matches(given: str | None, expected: str) -> bool:
    incoming = (given or "").encode("utf-8")
    wanted = expected.encode("utf-8")
    if len(incoming) != len(wanted):
        hmac.compare_digest(wanted, wanted)
        return False
    return hmac.compare_digest(incoming, wanted)


def require_api_secret(x_api_secret: str | None = Header(default=None, alias="x-api-secret")) -> None:
    expected = _ideas_api_secret()
    if not expected or not _secret_matches(x_api_secret, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


def _rate_limit_generate(user_id: str) -> None:
    now = time.monotonic()
    bucket = _generate_hits[user_id]
    while bucket and now - bucket[0] > GENERATE_RATE_WINDOW_SEC:
        bucket.popleft()
    if len(bucket) >= GENERATE_RATE_LIMIT:
        raise HTTPException(status_code=429, detail="Too many requests")
    bucket.append(now)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    if len(_ideas_api_secret()) < 32:
        raise RuntimeError("IDEAS_API_SECRET is not configured.")
    _log_openai_key_status()
    yield


app = FastAPI(
    title="Արի Գնանք Idea Agent",
    version="1.0.0",
    lifespan=lifespan,
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
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


@app.post("/api/generate-ideas", response_model=GenerateIdeasResponse, dependencies=[Depends(require_api_secret)])
def generate_ideas(
    body: GenerateIdeasRequest,
    x_user_id: str | None = Header(default=None, alias="x-user-id"),
) -> GenerateIdeasResponse:
    try:
        user_id = str(UUID((x_user_id or "").strip()))
    except ValueError:
        raise HTTPException(status_code=401, detail="Unauthorized") from None
    _rate_limit_generate(user_id)
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
    except ValidationError:
        raise HTTPException(status_code=502, detail="Idea generation failed.") from None
    except RuntimeError:
        raise HTTPException(status_code=502, detail="Idea generation failed.") from None
    except Exception:
        raise HTTPException(status_code=500, detail="Tour idea generation failed.") from None


@app.get("/api/idea-runs/{run_id}", response_model=GenerateIdeasResponse, dependencies=[Depends(require_api_secret)])
def read_idea_run(run_id: str) -> GenerateIdeasResponse:
    try:
        UUID(run_id)
    except ValueError:
        raise HTTPException(status_code=404, detail="Idea run not found.") from None
    record = get_run(run_id)
    if not record:
        raise HTTPException(status_code=404, detail="Idea run not found.")
    ideas = [TourIdea.model_validate(item) for item in record.get("ideas") or []]
    return GenerateIdeasResponse(
        run_id=str(record.get("id") or run_id),
        ideas=ideas,
        research_summary=str(record.get("research_summary") or ""),
    )
