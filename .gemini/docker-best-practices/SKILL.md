---
name: docker-and-docker-compose-best-practices
description: Describes Docker and Docker Compose requirements and best practices
---
# Docker and Deployment

## **Dockerfile** must always be perfectly optimized
- Staged builds producing minimal image size
- All unnecessary files are excluded from the final build
- All dependencies version are pinned
- Entrypoint, command, init processes, gid and similar are following best practices
- ENV variables are handled correctly (build and runtime) if necessary
- Always builds succesfully

## Docker Compose is the main deployment target
- Ensure that running `docker compose up --build` spins up entire production-like infrastructure
- Load balancers and reverse proxies could be ignored for this purpose
- All dependencies (i.e. database etc) exist in docker compose
- All processes have their containers (web, jobs etc)
- Setup is handled as a separate container which has to exist succesfully
- Dependencies, networks and volumes are always defined correctly
- Must run on linux and mac
