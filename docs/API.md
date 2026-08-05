# API Design: FlowPilot

## 1. Purpose
This document outlines the RESTful HTTP API exposed by the `apps/api` service. It is the primary ingress point for all users, third-party webhook integrations (like Caspian), and the Dashboard frontend.

For the underlying data model behind these endpoints, see [DOMAIN_MODEL.md](DOMAIN_MODEL.md).

## 2. API Philosophy & Rules
- **No Business Logic:** Controllers *only* parse the HTTP request, validate it against a Zod schema, pass the DTO (Data Transfer Object) to the Orchestrator or Planner, and format the HTTP response.
- **Idempotency:** Mutations should be safe to retry. (e.g., Calling `POST /workflows/:id/cancel` multiple times should succeed without crashing or corrupting state).
- **JSON Standard:** All requests and responses use `application/json`.

## 3. Versioning Strategy
- **MVP & Future:** The API uses strict URI versioning (e.g., `/v1/workflows`). 
- **Why Chosen:** URI versioning is explicit and easily cacheable/routable at the infrastructure level (e.g., Nginx, AWS API Gateway), unlike Header-based versioning which requires application-level inspection to route traffic.

## 4. Core Endpoints (v1)

### 4.1 `POST /v1/workflows/plan`
**Purpose:** Submits natural language intent to the Planner to generate a workflow blueprint. It does *not* execute the workflow.
- **Request Body:**
  ```json
  {
    "prompt": "Compress my images and upload to S3",
    "trigger_type": "MANUAL"
  }
  ```
- **Response (201 Created):**
  ```json
  {
    "workflow_id": "uuid",
    "status": "DRAFT",
    "steps": [ ... ]
  }
  ```

### 4.2 `POST /v1/workflows/:id/execute`
**Purpose:** Triggers the Orchestrator to begin executing a previously planned workflow.
- **Response (202 Accepted):** Returns immediately. Does not wait for the workflow to finish (which could take hours).
  ```json
  {
    "execution_id": "uuid",
    "status": "PENDING"
  }
  ```

### 4.3 `GET /v1/executions/:id`
**Purpose:** Retrieves the current status of an ongoing or historical execution. Used heavily by the Dashboard.
- **Response (200 OK):**
  ```json
  {
    "execution_id": "uuid",
    "workflow_id": "uuid",
    "status": "RUNNING",
    "started_at": "iso-date",
    "completed_at": null,
    "steps": [
       { "step_id": "uuid", "status": "COMPLETED" },
       { "step_id": "uuid", "status": "RUNNING", "worker_id": "uuid" }
    ]
  }
  ```

### 4.4 `POST /v1/executions/:id/cancel`
**Purpose:** Aborts a running execution.
- **Response (200 OK):**
  ```json
  {
    "execution_id": "uuid",
    "status": "CANCELED"
  }
  ```

## 5. Standard Status Codes
- `200 OK`: Successful read or update.
- `201 Created`: Successful creation (returns ID).
- `202 Accepted`: Command accepted for asynchronous processing.
- `400 Bad Request`: Zod validation failure (returns specific schema errors).
- `401 Unauthorized`: Missing or invalid API key.
- `404 Not Found`: Resource does not exist.
- `429 Too Many Requests`: Rate limit exceeded.
- `500 Internal Server Error`: Unhandled system crash.

## 6. Design Decisions & Trade-offs

### 6.1 Synchronous vs Asynchronous Execution
- **Why Chosen (Asynchronous 202 Accepted):** Workflows are inherently long-running. Keeping an HTTP connection open for 10 minutes while a workflow runs will result in dropped connections, LB timeouts, and memory leaks. The API *must* return immediately and require the client to poll (or use WebSockets) to get the result.
- **Alternatives Considered:** Synchronous `POST /execute` that waits for the final result.
- **Why Rejected:** Architecturally incompatible with horizontally scalable, multi-step orchestration.

## 7. Future Scalability

### 7.1 Real-time Streaming (WebSockets / SSE)
- **Future Production Requirement:** Polling `GET /v1/executions/:id` every 2 seconds is inefficient. We will introduce Server-Sent Events (SSE) or WebSockets at `/v1/executions/:id/stream` to push state changes to the Dashboard directly from the Redis Event Bus.
