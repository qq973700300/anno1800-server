package com.anno.exception;

/** 业务异常：会被全局处理器转成 {"ok":false,"code":...,"message":...} */
public class GameException extends RuntimeException {

    private final String code;

    public GameException(String code, String message) {
        super(message);
        this.code = code;
    }

    public String getCode() {
        return code;
    }

    public static GameException of(String message) {
        return new GameException("BAD_REQUEST", message);
    }
}
