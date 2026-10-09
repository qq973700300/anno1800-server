package com.anno.dto;

/** 统一接口返回包装：ok + code + message + data */
public record ApiResponse<T>(boolean ok, String code, String message, T data) {

    public static <T> ApiResponse<T> ok(T data) {
        return new ApiResponse<>(true, "OK", "success", data);
    }

    public static <T> ApiResponse<T> fail(String code, String message) {
        return new ApiResponse<>(false, code, message, null);
    }
}
