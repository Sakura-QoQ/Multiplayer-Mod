# syntax=docker/dockerfile:1

# 构建阶段只恢复房间服务器项目，不把游戏 Mod、测试产物或开发工具放入镜像。
FROM mcr.microsoft.com/dotnet/sdk:8.0-noble AS build
WORKDIR /source

COPY src/MultiplayerRoomServer/MultiplayerRoomServer.csproj src/MultiplayerRoomServer/
RUN dotnet restore src/MultiplayerRoomServer/MultiplayerRoomServer.csproj

COPY src/MultiplayerRoomServer/ src/MultiplayerRoomServer/
RUN dotnet publish src/MultiplayerRoomServer/MultiplayerRoomServer.csproj \
    --configuration Release \
    --no-restore \
    --output /output \
    --no-self-contained \
    -p:UseAppHost=false \
    -p:DebugType=None \
    -p:DebugSymbols=false

# Chiseled Ubuntu 镜像不带 Shell 和包管理器，减少无关组件与攻击面。
FROM mcr.microsoft.com/dotnet/runtime:8.0-noble-chiseled AS runtime
WORKDIR /app

LABEL org.opencontainers.image.title="Fallen Flower Room Server" \
      org.opencontainers.image.description="Room management and opaque relay service for PlayerHostedMultiplayer" \
      org.opencontainers.image.licenses="LicenseRef-Proprietary"

ENV DOTNET_EnableDiagnostics=0 \
    FF_ROOM_LISTEN=0.0.0.0 \
    FF_ROOM_PORT=27777 \
    FF_ROOM_MAX_ROOMS=256 \
    FF_ROOM_MAX_PLAYERS=8

COPY --from=build --chown=$APP_UID:$APP_UID /output/ ./
COPY --chown=$APP_UID:$APP_UID LICENSE LICENSE.zh-CN /licenses/

USER $APP_UID
EXPOSE 27777/tcp
ENTRYPOINT ["dotnet", "FallenFlowerRoomServer.dll"]
