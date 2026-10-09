package com.anno.ws;

import java.io.IOException;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.anno.dto.Views;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import tools.jackson.databind.ObjectMapper;

/**
 * 联机会话中枢：管理所有在线连接，负责广播世界状态与实时事件。
 * <p>
 * 客户端连上 ws://host/ws 后发 {"type":"auth","playerId":1} 即可绑定身份。
 */
@Component
public class GameSocketHub {

    private final ObjectMapper mapper;
    /** 所有连接 */
    private final Set<WebSocketSession> sessions = ConcurrentHashMap.newKeySet();
    /** session -> 玩家 id */
    private final Map<WebSocketSession, Long> bound = new ConcurrentHashMap<>();

    public GameSocketHub(ObjectMapper mapper) {
        this.mapper = mapper;
    }

    public void add(WebSocketSession session) {
        sessions.add(session);
        send(session, Map.of("type", "welcome",
                "data", Map.of("message", "已连接纪元1800世界，请发送 {\"type\":\"auth\",\"playerId\":你的ID}",
                        "serverTime", System.currentTimeMillis())));
    }

    public void remove(WebSocketSession session) {
        sessions.remove(session);
        bound.remove(session);
    }

    public void bind(WebSocketSession session, Long playerId) {
        bound.put(session, playerId);
    }

    public Long playerOf(WebSocketSession session) {
        return bound.get(session);
    }

    public Set<Long> onlinePlayerIds() {
        Set<Long> ids = new java.util.HashSet<>();
        bound.values().forEach(id -> {
            if (id != null) ids.add(id);
        });
        return ids;
    }

    public int sessionCount() {
        return sessions.size();
    }

    /** 广播给所有在线客户端 */
    public void broadcast(String type, Object data) {
        String payload = toJson(Map.of("type", type, "data", data));
        for (WebSocketSession s : sessions) {
            if (s.isOpen()) send(s, payload);
        }
    }

    /** 只推给某个玩家的所有连接 */
    public void sendToPlayer(Long playerId, String type, Object data) {
        String payload = toJson(Map.of("type", type, "data", data));
        bound.forEach((session, id) -> {
            if (playerId.equals(id) && session.isOpen()) send(session, payload);
        });
    }

    /** 世界频道聊天 */
    public void chat(String from, String text) {
        broadcast("chat", Map.of("from", from, "text", text, "time", System.currentTimeMillis()));
    }

    public void event(Views.GameEvent event) {
        broadcast("event", event);
    }

    private void send(WebSocketSession session, String payload) {
        try {
            synchronized (session) {
                session.sendMessage(new TextMessage(payload));
            }
        } catch (IOException e) {
            remove(session);
        }
    }

    private void send(WebSocketSession session, Map<String, Object> msg) {
        send(session, toJson(msg));
    }

    private String toJson(Object obj) {
        return mapper.writeValueAsString(obj);
    }
}
