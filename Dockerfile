# syntax=docker/dockerfile:1

# ---- build the front end ---------------------------------------------------
FROM node:26-alpine AS build
WORKDIR /app

# Manifests first, so the dependency layer is cached independently of source.
COPY package.json package-lock.json ./
COPY web/package.json web/package-lock.json ./web/

# Root deps without scripts - its postinstall installs the web half, which is
# done explicitly on the next line so the two are cached separately. esbuild's
# postinstall is allow-listed in web/package.json, which npm 12 requires before
# it will fetch the platform binary.
RUN npm ci --ignore-scripts && npm ci --prefix web

COPY web/ ./web/
RUN npm run build

# ---- runtime ---------------------------------------------------------------
FROM node:26-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Day rollover is computed with Intl in an explicit timezone, which needs full
# ICU. Assert it at build time so a slim base fails here and loudly, rather
# than at midnight in a container nobody is watching.
RUN node -e "const d=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date()); if(!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new Error('unexpected format: '+d); console.log('full ICU ok ->', d)"

# Only express is needed to run. --ignore-scripts skips the root postinstall,
# which would otherwise drag the whole front-end toolchain into this stage.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY server/ ./server/
COPY --from=build /app/web/dist ./web/dist

# Profiles (with session cookies) and the claim log live here. Mount a volume
# over it or everything is lost when the container is replaced.
ENV DATA_DIR=/data
RUN mkdir -p /data && chown -R node:node /data /app
USER node

# Must listen on all interfaces to be reachable from outside the container.
# Keeping this safe is the *published* port's job - see compose.yml, which
# binds it to host loopback.
ENV HOST=0.0.0.0
ENV PORT=8787
EXPOSE 8787

HEALTHCHECK --interval=60s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/status').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
