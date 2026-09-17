"""用户路由"""

from ipaddress import ip_address

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from app.core.auth import get_current_user
from app.core.config import get_settings
from app.models.common import ApiResponse
from app.models.user import LoginRequest, UpdateProfileRequest
from app.services import user_service, history_service

router = APIRouter(prefix="/user", tags=["user"])


def _require_managed_host(request: Request) -> None:
    from secrets import compare_digest
    settings = get_settings()
    supplied = request.headers.get("x-betterlearn-host", "")
    peer = request.client.host if request.client else ""
    if (not settings.managed_host_token
        or not compare_digest(settings.managed_host_token.encode(), supplied.encode())
        or peer not in {"127.0.0.1", "::1"}):
        raise HTTPException(status_code=403, detail="Managed host required")


@router.get("/active-tasks", response_model=ApiResponse)
async def active_tasks(request: Request):
    _require_managed_host(request)
    from app.repositories.task_repository import has_active_tasks
    return ApiResponse.success(data={"active": await has_active_tasks()})


@router.post("/host-session", response_model=ApiResponse)
async def host_session(request: Request):
    """Private session bootstrap; the managed middleware verifies the host secret."""
    _require_managed_host(request)
    result = await user_service.handle_local_login()
    return ApiResponse.success(data=result.model_dump())


@router.post("/login", response_model=ApiResponse)
async def login(req: LoginRequest):
    result = await user_service.handle_login(req.code)
    return ApiResponse.success(data=result.model_dump())


@router.post("/local-login", response_model=ApiResponse)
async def local_login(request: Request):
    settings = get_settings()
    peer_host = request.client.host if request.client else ""
    try:
        peer_is_loopback = ip_address(peer_host).is_loopback
    except ValueError:
        peer_is_loopback = False

    trusted_hosts = {
        f"127.0.0.1:{settings.app_port}",
        f"localhost:{settings.app_port}",
    }
    trusted_origins = {
        origin.strip()
        for origin in settings.local_login_trusted_origins.split(",")
        if origin.strip()
    }
    if (
        not settings.local_login_enabled
        or not peer_is_loopback
        or request.headers.get("host") not in trusted_hosts
        or request.headers.get("origin") not in trusted_origins
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Local login is not allowed for this request",
        )

    result = await user_service.handle_local_login()
    return ApiResponse.success(data=result.model_dump())


@router.get("/profile", response_model=ApiResponse)
async def get_profile(user_id: int = Depends(get_current_user)):
    result = await user_service.get_profile(user_id)
    return ApiResponse.success(data=result.model_dump())


@router.put("/profile", response_model=ApiResponse)
async def update_profile(
    req: UpdateProfileRequest,
    user_id: int = Depends(get_current_user),
):
    await user_service.update_profile(user_id, req.nickname, req.avatar_url)
    return ApiResponse.success()


@router.get("/quizzes", response_model=ApiResponse)
async def get_quiz_list(
    page: int = Query(1, ge=1),
    page_size: int = Query(10, ge=1, le=50),
    user_id: int = Depends(get_current_user),
):
    result = await history_service.get_quiz_history(user_id, page, page_size)
    return ApiResponse.success(data=result.model_dump())


@router.get("/quizzes/{quiz_id}", response_model=ApiResponse)
async def get_quiz_detail(
    quiz_id: str,
    user_id: int = Depends(get_current_user),
):
    result = await history_service.get_quiz_detail(quiz_id, user_id)
    if result is None:
        return ApiResponse.error(code=4004, message="闯关记录不存在")
    return ApiResponse.success(data=result.model_dump())
