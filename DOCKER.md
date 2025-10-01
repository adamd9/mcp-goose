# Docker Deployment Guide

This guide covers deploying mcp-goose using Docker Compose.

## Quick Start

1. **Copy the example files:**
   ```bash
   cp docker-compose.example.yml docker-compose.yml
   cp .env.example .env
   ```

2. **Edit `.env` with your configuration:**
   ```bash
   nano .env
   ```
   
   Required changes:
   - Set `AUTH_TOKEN` to a strong secret
   - Set `PROJECT_NAME` to your project name (e.g., `my-website`)
   - Set `GOOSE_PROVIDER__API_KEY` and `OPENAI_API_KEY` to your OpenAI API key

3. **Create data directories:**
   ```bash
   mkdir -p data/{projects,goose-sessions,goose-logs,preview-cache}
   ```

4. **Start the service:**
   ```bash
   docker-compose up -d
   ```

5. **Check logs:**
   ```bash
   docker-compose logs -f mcp-goose
   ```

## Configuration Options

### Project Directory

Choose one of these options:

- **`PROJECT_NAME`** (recommended): Simple project name. The server creates and manages `./data/projects/<PROJECT_NAME>/` automatically.
  ```env
  PROJECT_NAME=my-website
  ```

- **`GOOSE_SCOPE_DIR`**: Absolute path to an existing project. Use this when you need full control.
  ```env
  GOOSE_SCOPE_DIR=/workspace/existing-project
  ```
  
  If using `GOOSE_SCOPE_DIR`, you'll need to mount that directory in `docker-compose.yml`:
  ```yaml
  volumes:
    - /path/to/existing/project:/workspace/existing-project
  ```

### Volumes

The example compose file uses relative paths (`./data/...`) for easy local development. For production, consider absolute paths:

```yaml
volumes:
  - /opt/docker-data/mcp-goose/projects:/app/mcp-goose/projects
  - /opt/docker-data/mcp-goose/goose-sessions:/root/.local/share/goose
  - /opt/docker-data/mcp-goose/goose-logs:/root/.local/state/goose
  - /opt/docker-data/mcp-goose/preview-cache:/root/.cache/mcp-goose
```

## Accessing the Service

- **MCP endpoint:** `http://localhost:3003/mcp` (POST with `Authorization: Bearer <AUTH_TOKEN>`)
- **Status:** `http://localhost:3003/status`
- **Preview sites:**
  - Main branch: `http://localhost:3003/`
  - Feature branches: `http://localhost:3003/.preview/<branch>/`

## Using with Traefik

If you're using Traefik as a reverse proxy, add labels to `docker-compose.yml`:

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.mcp-goose.rule=Host(`mcp-goose.yourdomain.com`)"
  - "traefik.http.routers.mcp-goose.entrypoints=websecure"
  - "traefik.http.routers.mcp-goose.tls.certresolver=myresolver"
  - "traefik.http.services.mcp-goose.loadbalancer.server.port=3003"
networks:
  default:
    name: reverse-proxy
    external: true
```

Remove the `ports:` section if using Traefik (it will handle routing).

## Updating

To update to the latest version:

```bash
docker-compose down
docker-compose pull
docker-compose up -d
```

The startup command automatically pulls the latest code from GitHub on each restart.

## Troubleshooting

**Container keeps restarting:**
- Check logs: `docker-compose logs mcp-goose`
- Verify `.env` has `AUTH_TOKEN` and either `PROJECT_NAME` or `GOOSE_SCOPE_DIR`
- Ensure API keys are valid

**Preview not updating:**
- Check that the project directory is properly mounted
- Verify git is working inside the container: `docker-compose exec mcp-goose git --version`
- Check watcher logs in `docker-compose logs`

**Permission issues:**
- The container runs as root by default
- Ensure host directories have appropriate permissions: `chmod -R 755 data/`

## Security Notes

- Never commit `.env` or `docker-compose.yml` with secrets to version control
- Use strong, unique values for `AUTH_TOKEN`
- Keep API keys secure and rotate them regularly
- Consider using Docker secrets for production deployments
