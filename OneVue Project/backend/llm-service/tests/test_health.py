"""Unit and integration tests for service health and root endpoints."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint_status_and_body():
    """Verify GET /health returns expected status and payload."""
    response = client.get("/health")
    assert response.status_code == 200

    data = response.json()
    assert data == {
        "status": "ok",
        "service": "onevue-llm-service",
        "version": "1.0.0",
    }


def test_health_endpoint_does_not_expose_secrets():
    """Ensure sensitive credentials or keys are never returned by /health."""
    response = client.get("/health")
    assert response.status_code == 200

    data = response.json()
    forbidden_keys = {
        "api_key",
        "secret",
        "groq_api_key",
        "nvidia_api_key",
        "service_api_key",
        "GROQ_API_KEY",
        "NVIDIA_API_KEY",
        "SERVICE_API_KEY",
    }
    present_keys = set(data.keys())
    assert not (present_keys & forbidden_keys)


def test_root_endpoint():
    """Verify GET / returns service information and docs direction."""
    response = client.get("/")
    assert response.status_code == 200

    data = response.json()
    assert data["service"] == "onevue-llm-service"
    assert data["version"] == "1.0.0"
    assert data["docs_url"] == "/docs"
    assert data["openapi_url"] == "/openapi.json"


def test_docs_and_openapi_availability():
    """Verify interactive documentation and OpenAPI schema endpoints respond."""
    docs_response = client.get("/docs")
    assert docs_response.status_code == 200

    openapi_response = client.get("/openapi.json")
    assert openapi_response.status_code == 200
    openapi_data = openapi_response.json()
    assert openapi_data["info"]["title"] == "ONEVUE LLM Service"
