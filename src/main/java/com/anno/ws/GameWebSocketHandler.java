package com.anno.ws;

import java.util.Map;

import com.anno.domain.PlayerEntity;
import com.anno.repo.PlayerRepository;
import com.anno.service.PlayerService;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;
import tools.jackson.databind.ObjectMapper;

/**
 * 客户端指令入口：auth / ping / chat
 */
@Component
public class GameWebSocketHandler extends TextWebSocketHandler {

    private final GameSocketHub hub;
    private final PlayerRepository playerRepository;
    private final PlayerService playerService;
    private final ObjectMapper mapper;

    public GameWebSocketHandler(GameSocketHub hub, PlayerRepository playerRepository,
                                PlayerService playerService, ObjectMapper mapper) {
        this.hub = hub;
        this.playerRepository = playerRepository;
        this.playerService = playerService;
        this.mapper = mapper;
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        hub.add(session);
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) {
        Map<String, Object> msg;
        try {
            msg = mapper.readValue(message.getPayload(), Map.class);
        } catch (Exception e) {
            return;
        }
        Object type = msg.get("type");
        if (type == null) return;

        switch (type.toString()) {
            case "auth" -> {
                Long playerId = toLong(msg.get("playerId"));
                if (playerId == null) return;
                PlayerEntity player = playerRepository.findById(playerId).orElse(null);
                if (player == null) return;
                // 原子 UPDATE：只改 online / last_seen，不参与金库的乐观锁竞争
                playerService.touch(playerId, true);
                hub.bind(session, playerId);
                hub.sendToPlayer(playerId, "authed",
                        Map.of("playerId", player.getId(), "name", player.getName(),
                                "treasury", player.getTreasury()));
                hub.broadcast("event", Map.of("type", "PLAYER_ONLINE", "serverTime", System.currentTimeMillis(),
                        "payload", Map.of("playerId", player.getId(), "name", player.getName())));
            }
            case "ping" -> hub.sendToPlayer(hub.playerOf(session), "pong",
                    Map.of("time", System.currentTimeMillis()));
            case "chat" -> {
                Long playerId = hub.playerOf(session);
                String name = playerId == null ? "匿名"
                        : playerRepository.findById(playerId).map(PlayerEntity::getName).orElse("匿名");
                Object text = msg.get("text");
                hub.chat(name, text == null ? "" : text.toString());
            }
            default -> {
                // 未知类型忽略
            }
        }
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        Long playerId = hub.playerOf(session);
        hub.remove(session);
        if (playerId != null && !hub.onlinePlayerIds().contains(playerId)) {
            playerService.touch(playerId, false);
            hub.broadcast("event", Map.of("type", "PLAYER_OFFLINE", "serverTime", System.currentTimeMillis(),
                    "payload", Map.of("playerId", playerId)));
        }
    }

    private Long toLong(Object v) {
        if (v == null) return null;
        return Long.parseLong(v.toString());
    }
}
