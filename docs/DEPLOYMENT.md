# Deployment & Kubernetes Strategy

*Note: Currently, Kubernetes is not required for local development or the initial phase. This document serves as a blueprint for when we are ready to transition to a production-grade Kubernetes cluster.*

## Kubernetes Architecture Plan

When we migrate to Kubernetes, the infrastructure should be scaffolded as follows:

1. **ConfigMaps & Secrets**
   - **`configmap.yaml`**: For non-sensitive environment variables (e.g., `PORT=3250`).
   - **`secrets.yaml`**: For sensitive data like `DATABASE_URL`, `POSTGRES_PASSWORD`, `REDIS_URL`, and `GITHUB_TOKEN`. (In a true production environment, consider using a Secrets Manager like AWS Secrets Manager or ExternalSecrets).

2. **Databases & Caching**
   - **`postgres.yaml`**: A StatefulSet and Service for PostgreSQL. Must include a `PersistentVolumeClaim` (PVC) for data persistence.
   - **`redis.yaml`**: A Deployment and Service for Redis.

3. **Application Services**
   - **`api.yaml`**: A Deployment and ClusterIP Service for the API, exposing port 3250.
   - **`worker.yaml`**: A Deployment for the background worker (does not require a Service since it only consumes queues and databases).

## Next Steps After Pushing to Main

Once the current codebase is pushed to the repository, here is the suggested deployment workflow:

1. **Configure CI/CD (GitHub Actions):** 
   - Set up a workflow to automatically build the `aether-api` and `aether-worker` Docker images on every push to the `main` branch.
   - Push these built images to a Container Registry (e.g., GitHub Container Registry (GHCR), Docker Hub, or AWS ECR).

2. **Provision Infrastructure:** 
   - Provision a managed Kubernetes cluster (like Amazon EKS, Google GKE, or DigitalOcean Kubernetes).
   - Alternatively, start with a simple VM (like an EC2 instance or Droplet) running `docker-compose up -d` if Kubernetes is overkill for the early launch phase.

3. **Configure Ingress & Networking:** 
   - Set up an Ingress controller (like NGINX) to expose your API to the public internet securely.
   - Attach a domain name and configure TLS/SSL certificates using `cert-manager` and Let's Encrypt.

4. **Deploy:** 
   - Apply the Kubernetes manifests using `kubectl apply -f kubernetes/` or use a GitOps tool like ArgoCD or Flux for automated deployments.
