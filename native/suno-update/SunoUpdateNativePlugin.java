package com.sunoapp.downloader.update;

import android.Manifest;
import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.net.URL;
import java.util.Locale;

/**
 * Restricted Android update downloader.
 * Only APK assets from this application's GitHub Releases are accepted.
 */
@CapacitorPlugin(
    name = "SunoUpdateNative",
    permissions = {
        @Permission(alias = "legacyStorage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE })
    }
)
public class SunoUpdateNativePlugin extends Plugin {
    private static final String RELEASE_HOST = "github.com";
    private static final String RELEASE_PATH_PREFIX = "/t59688/suno-downloader-app/releases/download/";
    private static final String APK_MIME = "application/vnd.android.package-archive";

    @PluginMethod
    public void downloadUpdate(PluginCall call) {
        if (needsLegacyStoragePermission()) {
            requestPermissionForAlias("legacyStorage", call, "downloadUpdatePermissionCallback");
            return;
        }
        downloadUpdateInternal(call);
    }

    @PermissionCallback
    private void downloadUpdatePermissionCallback(PluginCall call) {
        if (needsLegacyStoragePermission()) {
            call.reject("没有存储权限，无法下载更新");
            return;
        }
        downloadUpdateInternal(call);
    }

    private void downloadUpdateInternal(PluginCall call) {
        String rawUrl = call.getString("url", "").trim();
        String fileName = sanitizeApkName(call.getString("fileName", "suno-downloader.apk"));
        URL parsed;
        try {
            parsed = new URL(rawUrl);
        } catch (Exception e) {
            call.reject("更新地址无效");
            return;
        }

        if (!"https".equalsIgnoreCase(parsed.getProtocol())
            || !RELEASE_HOST.equalsIgnoreCase(parsed.getHost())
            || !parsed.getPath().startsWith(RELEASE_PATH_PREFIX)
            || !parsed.getPath().toLowerCase(Locale.ROOT).endsWith(".apk")) {
            call.reject("更新地址不在允许的 Release 范围内");
            return;
        }

        DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("系统下载服务不可用");
            return;
        }

        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(rawUrl));
            request.setTitle("Suno 下载器更新");
            request.setDescription(fileName);
            request.setMimeType(APK_MIME);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(false);
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setDestinationInExternalPublicDir(
                Environment.DIRECTORY_DOWNLOADS,
                "Suno Downloader/" + fileName
            );
            long downloadId = manager.enqueue(request);
            JSObject result = new JSObject();
            result.put("downloadId", downloadId);
            call.resolve(result);
        } catch (Exception e) {
            call.reject("无法启动更新下载");
        }
    }

    private boolean needsLegacyStoragePermission() {
        return Build.VERSION.SDK_INT <= Build.VERSION_CODES.P
            && getPermissionState("legacyStorage") != PermissionState.GRANTED;
    }

    private static String sanitizeApkName(String value) {
        String safe = value == null ? "" : value
            .replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_")
            .trim();
        if (safe.length() > 140) safe = safe.substring(0, 140).trim();
        if (!safe.toLowerCase(Locale.ROOT).endsWith(".apk")) safe += ".apk";
        return safe.isEmpty() ? "suno-downloader.apk" : safe;
    }
}
