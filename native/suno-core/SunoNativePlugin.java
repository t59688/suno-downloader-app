package com.sunoapp.downloader.core;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;

import androidx.core.app.NotificationCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import javax.net.ssl.HttpsURLConnection;

/**
 * Native Android services used by the downloader.
 *
 * This source is kept outside the generated android/ tree so clean CI runners can
 * reproduce the same native capabilities as local builds.
 */
@CapacitorPlugin(
    name = "SunoNative",
    permissions = {
        @Permission(alias = "legacyStorage", strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }),
        @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
    }
)
public class SunoNativePlugin extends Plugin {
    private static final String PAGE_PROXY_HOST = "sunoapi.aibiei.com";
    private static final String RIGHTS_URL = "https://yellow-salad.aibiei.com/rights";
    private static final String RIGHTS_ORIGIN = "https://usesuno.com";
    private static final String CHANNEL_ID = "suno_downloads";
    private static final int NOTIFICATION_ID = 41001;
    private static final int CONNECT_TIMEOUT_MS = 15_000;
    private static final int READ_TIMEOUT_MS = 30_000;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Map<String, SaveSession> saveSessions = new ConcurrentHashMap<>();
    private volatile String notificationTitle = "Suno Downloader";
    private volatile boolean destroyed;

    @Override
    public void load() {
        ensureNotificationChannel();
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        for (SaveSession session : saveSessions.values()) {
            abortSession(session);
        }
        saveSessions.clear();
        main.removeCallbacksAndMessages(null);
        io.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void pageGet(PluginCall call) {
        String rawUrl = call.getString("url", "");
        URL url;
        try {
            url = new URL(rawUrl);
        } catch (Exception e) {
            call.reject("页面代理 URL 无效");
            return;
        }
        if (!"https".equalsIgnoreCase(url.getProtocol())
            || !PAGE_PROXY_HOST.equalsIgnoreCase(url.getHost())
            || !"/proxy".equals(url.getPath())) {
            call.reject("页面代理目标不在允许列表");
            return;
        }
        executeHttp(call, () -> request("GET", url, null, null));
    }

    @PluginMethod
    public void rightsPost(PluginCall call) {
        String body = call.getString("body", "");
        if (body.isEmpty()) {
            call.reject("rights 请求体为空");
            return;
        }
        try {
            URL url = new URL(RIGHTS_URL);
            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Type", "application/json; charset=utf-8");
            headers.put("Origin", RIGHTS_ORIGIN);
            headers.put("Accept", "application/json");
            executeHttp(call, () -> request(
                "POST",
                url,
                body.getBytes(StandardCharsets.UTF_8),
                headers
            ));
        } catch (Exception e) {
            call.reject("rights URL 初始化失败");
        }
    }

    private void executeHttp(PluginCall call, HttpWork work) {
        io.execute(() -> {
            try {
                HttpResult result = work.run();
                if (result.status < 200 || result.status >= 300) {
                    rejectOnMain(call, "网络请求失败 (HTTP " + result.status + ")");
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("status", result.status);
                ret.put("body", result.body);
                resolveOnMain(call, ret);
            } catch (Exception e) {
                rejectOnMain(call, "网络请求失败，请检查网络后重试");
            }
        });
    }

    private HttpResult request(String method, URL url, byte[] body, Map<String, String> headers) throws Exception {
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        try {
            connection.setRequestMethod(method);
            connection.setConnectTimeout(CONNECT_TIMEOUT_MS);
            connection.setReadTimeout(READ_TIMEOUT_MS);
            connection.setUseCaches(false);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("Accept", "*/*");
            if (headers != null) {
                for (Map.Entry<String, String> entry : headers.entrySet()) {
                    connection.setRequestProperty(entry.getKey(), entry.getValue());
                }
            }
            if (body != null) {
                connection.setDoOutput(true);
                connection.setFixedLengthStreamingMode(body.length);
                try (OutputStream out = connection.getOutputStream()) {
                    out.write(body);
                }
            }
            int status = connection.getResponseCode();
            InputStream stream = status >= HttpURLConnection.HTTP_BAD_REQUEST
                ? connection.getErrorStream()
                : connection.getInputStream();
            String responseBody = stream == null ? "" : readUtf8(stream);
            return new HttpResult(status, responseBody);
        } finally {
            connection.disconnect();
        }
    }

    @PluginMethod
    public void notifyStart(PluginCall call) {
        if (needsNotificationPermission()) {
            requestPermissionForAlias("notifications", call, "notifyStartPermissionCallback");
            return;
        }
        showStartNotification(call);
    }

    @PermissionCallback
    private void notifyStartPermissionCallback(PluginCall call) {
        showStartNotification(call);
    }

    private void showStartNotification(PluginCall call) {
        notificationTitle = call.getString("title", "Suno Downloader");
        String subtitle = call.getString("subtitle", "正在处理…");
        if (canPostNotifications()) {
            NotificationCompat.Builder builder = baseNotification(notificationTitle, subtitle)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setProgress(0, 0, true);
            notificationManager().notify(NOTIFICATION_ID, builder.build());
        }
        call.resolve();
    }

    @PluginMethod
    public void notifyProgress(PluginCall call) {
        int percent = Math.max(0, Math.min(99, call.getInt("percent", 0)));
        if (canPostNotifications()) {
            NotificationCompat.Builder builder = baseNotification(notificationTitle, "下载中 · " + percent + "%")
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setProgress(100, percent, false);
            notificationManager().notify(NOTIFICATION_ID, builder.build());
        }
        call.resolve();
    }

    @PluginMethod
    public void notifyComplete(PluginCall call) {
        String text = call.getString("text", "下载完成");
        if (canPostNotifications()) {
            NotificationCompat.Builder builder = baseNotification(notificationTitle, text)
                .setOngoing(false)
                .setAutoCancel(true)
                .setProgress(0, 0, false);
            notificationManager().notify(NOTIFICATION_ID, builder.build());
        }
        call.resolve();
    }

    @PluginMethod
    public void notifyFail(PluginCall call) {
        String message = call.getString("message", "下载失败");
        if (canPostNotifications()) {
            NotificationCompat.Builder builder = baseNotification(notificationTitle, message)
                .setOngoing(false)
                .setAutoCancel(true)
                .setProgress(0, 0, false);
            notificationManager().notify(NOTIFICATION_ID, builder.build());
        }
        call.resolve();
    }

    @PluginMethod
    public void notifyCancel(PluginCall call) {
        notificationManager().cancel(NOTIFICATION_ID);
        call.resolve();
    }

    private NotificationCompat.Builder baseNotification(String title, String text) {
        ensureNotificationChannel();
        return new NotificationCompat.Builder(getContext(), CHANNEL_ID)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_LOW);
    }

    private NotificationManager notificationManager() {
        return (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
    }

    private void ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(
                CHANNEL_ID,
                "Suno 下载",
                NotificationManager.IMPORTANCE_LOW
            );
            channel.setDescription("Suno Downloader 下载进度");
            notificationManager().createNotificationChannel(channel);
        }
    }

    private boolean needsNotificationPermission() {
        return Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
            && getPermissionState("notifications") != PermissionState.GRANTED;
    }

    private boolean canPostNotifications() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || getPermissionState("notifications") == PermissionState.GRANTED;
    }

    @PluginMethod
    public void saveFile(PluginCall call) {
        if (needsLegacyStoragePermission()) {
            requestPermissionForAlias("legacyStorage", call, "saveFilePermissionCallback");
            return;
        }
        saveFileInternal(call);
    }

    @PermissionCallback
    private void saveFilePermissionCallback(PluginCall call) {
        if (needsLegacyStoragePermission()) {
            call.reject("没有存储权限，无法保存文件");
            return;
        }
        saveFileInternal(call);
    }

    private void saveFileInternal(PluginCall call) {
        String fileName = sanitizeFileName(call.getString("fileName", "suno.bin"));
        String mime = normalizeMime(call.getString("mime", "application/octet-stream"));
        String base64 = call.getString("data", "");
        if (base64.isEmpty()) {
            call.reject("保存数据为空");
            return;
        }

        io.execute(() -> {
            SaveSession session = null;
            try {
                byte[] data = Base64.decode(base64, Base64.DEFAULT);
                session = openSaveSession(fileName, mime);
                session.output.write(data);
                session.output.flush();
                closeAndPublish(session);
                JSObject ret = saveResult(session);
                resolveOnMain(call, ret);
            } catch (Exception e) {
                if (session != null) abortSession(session);
                rejectOnMain(call, "保存文件失败: " + safeMessage(e));
            }
        });
    }

    @PluginMethod
    public void saveStreamStart(PluginCall call) {
        if (needsLegacyStoragePermission()) {
            requestPermissionForAlias("legacyStorage", call, "saveStreamStartPermissionCallback");
            return;
        }
        saveStreamStartInternal(call);
    }

    @PermissionCallback
    private void saveStreamStartPermissionCallback(PluginCall call) {
        if (needsLegacyStoragePermission()) {
            call.reject("没有存储权限，无法保存文件");
            return;
        }
        saveStreamStartInternal(call);
    }

    private void saveStreamStartInternal(PluginCall call) {
        String fileName = sanitizeFileName(call.getString("fileName", "suno.bin"));
        String mime = normalizeMime(call.getString("mime", "application/octet-stream"));
        io.execute(() -> {
            try {
                SaveSession session = openSaveSession(fileName, mime);
                saveSessions.put(session.id, session);
                JSObject ret = new JSObject();
                ret.put("sessionId", session.id);
                resolveOnMain(call, ret);
            } catch (Exception e) {
                rejectOnMain(call, "创建保存文件失败: " + safeMessage(e));
            }
        });
    }

    @PluginMethod
    public void saveStreamChunk(PluginCall call) {
        String sessionId = call.getString("sessionId", "");
        String chunk = call.getString("chunk", "");
        SaveSession session = saveSessions.get(sessionId);
        if (session == null) {
            call.reject("保存会话不存在或已结束");
            return;
        }
        io.execute(() -> {
            try {
                byte[] bytes = Base64.decode(chunk, Base64.DEFAULT);
                session.output.write(bytes);
                JSObject ret = new JSObject();
                ret.put("success", true);
                resolveOnMain(call, ret);
            } catch (Exception e) {
                saveSessions.remove(sessionId);
                abortSession(session);
                rejectOnMain(call, "写入文件失败: " + safeMessage(e));
            }
        });
    }

    @PluginMethod
    public void saveStreamFinish(PluginCall call) {
        String sessionId = call.getString("sessionId", "");
        SaveSession session = saveSessions.remove(sessionId);
        if (session == null) {
            call.reject("保存会话不存在或已结束");
            return;
        }
        io.execute(() -> {
            try {
                session.output.flush();
                closeAndPublish(session);
                resolveOnMain(call, saveResult(session));
            } catch (Exception e) {
                abortSession(session);
                rejectOnMain(call, "完成文件保存失败: " + safeMessage(e));
            }
        });
    }

    @PluginMethod
    public void saveStreamAbort(PluginCall call) {
        String sessionId = call.getString("sessionId", "");
        SaveSession session = saveSessions.remove(sessionId);
        if (session != null) {
            io.execute(() -> abortSession(session));
        }
        call.resolve();
    }

    @PluginMethod
    public void getClipboard(PluginCall call) {
        ClipboardManager manager = (ClipboardManager) getContext().getSystemService(Context.CLIPBOARD_SERVICE);
        String text = "";
        try {
            if (manager != null && manager.hasPrimaryClip()) {
                ClipData clip = manager.getPrimaryClip();
                if (clip != null && clip.getItemCount() > 0) {
                    CharSequence value = clip.getItemAt(0).coerceToText(getContext());
                    if (value != null) text = value.toString();
                }
            }
        } catch (Exception ignored) {
            text = "";
        }
        JSObject ret = new JSObject();
        ret.put("text", text);
        call.resolve(ret);
    }

    private boolean needsLegacyStoragePermission() {
        return Build.VERSION.SDK_INT <= Build.VERSION_CODES.P
            && getPermissionState("legacyStorage") != PermissionState.GRANTED;
    }

    private SaveSession openSaveSession(String fileName, String mime) throws Exception {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            return openMediaStoreSession(fileName, mime);
        }
        return openLegacySession(fileName, mime);
    }

    private SaveSession openMediaStoreSession(String fileName, String mime) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        Destination destination = destinationFor(mime);
        ContentValues values = new ContentValues();
        values.put(MediaStore.MediaColumns.DISPLAY_NAME, fileName);
        values.put(MediaStore.MediaColumns.MIME_TYPE, mime);
        values.put(MediaStore.MediaColumns.RELATIVE_PATH, destination.relativePath + "/Suno Downloader");
        values.put(MediaStore.MediaColumns.IS_PENDING, 1);

        Uri uri = resolver.insert(destination.collection, values);
        if (uri == null) throw new IllegalStateException("MediaStore 创建文件失败");
        OutputStream output = resolver.openOutputStream(uri, "w");
        if (output == null) {
            resolver.delete(uri, null, null);
            throw new IllegalStateException("MediaStore 打开文件失败");
        }
        String displayPath = destination.relativePath + "/Suno Downloader/" + fileName;
        return new SaveSession(UUID.randomUUID().toString(), output, uri, null, displayPath, mime, true);
    }

    @SuppressWarnings("deprecation")
    private SaveSession openLegacySession(String fileName, String mime) throws Exception {
        Destination destination = destinationFor(mime);
        File root = Environment.getExternalStoragePublicDirectory(destination.relativePath);
        File dir = new File(root, "Suno Downloader");
        if (!dir.exists() && !dir.mkdirs()) {
            throw new IllegalStateException("无法创建保存目录");
        }
        File file = uniqueFile(dir, fileName);
        OutputStream output = new FileOutputStream(file);
        return new SaveSession(
            UUID.randomUUID().toString(),
            output,
            Uri.fromFile(file),
            file,
            file.getAbsolutePath(),
            mime,
            false
        );
    }

    private void closeAndPublish(SaveSession session) throws Exception {
        if (!session.closed) {
            session.output.close();
            session.closed = true;
        }
        if (session.mediaStore) {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.IS_PENDING, 0);
            getContext().getContentResolver().update(session.uri, values, null, null);
        } else if (session.file != null) {
            MediaScannerConnection.scanFile(
                getContext(),
                new String[] { session.file.getAbsolutePath() },
                new String[] { session.mime },
                null
            );
        }
    }

    private void abortSession(SaveSession session) {
        if (session == null) return;
        try {
            if (!session.closed) {
                session.output.close();
                session.closed = true;
            }
        } catch (Exception ignored) {}
        try {
            if (session.mediaStore && session.uri != null) {
                getContext().getContentResolver().delete(session.uri, null, null);
            } else if (session.file != null && session.file.exists()) {
                //noinspection ResultOfMethodCallIgnored
                session.file.delete();
            }
        } catch (Exception ignored) {}
    }

    private JSObject saveResult(SaveSession session) {
        JSObject ret = new JSObject();
        ret.put("uri", session.uri == null ? "" : session.uri.toString());
        ret.put("path", session.displayPath);
        return ret;
    }

    private Destination destinationFor(String mime) {
        if (mime.startsWith("audio/")) {
            return new Destination(MediaStore.Audio.Media.EXTERNAL_CONTENT_URI, Environment.DIRECTORY_MUSIC);
        }
        if (mime.startsWith("image/")) {
            return new Destination(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, Environment.DIRECTORY_PICTURES);
        }
        if (mime.startsWith("video/")) {
            return new Destination(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, Environment.DIRECTORY_MOVIES);
        }
        Uri collection = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
            ? MediaStore.Downloads.EXTERNAL_CONTENT_URI
            : MediaStore.Files.getContentUri("external");
        return new Destination(collection, Environment.DIRECTORY_DOWNLOADS);
    }

    private static File uniqueFile(File dir, String fileName) {
        File candidate = new File(dir, fileName);
        if (!candidate.exists()) return candidate;
        int dot = fileName.lastIndexOf('.');
        String stem = dot > 0 ? fileName.substring(0, dot) : fileName;
        String ext = dot > 0 ? fileName.substring(dot) : "";
        for (int i = 1; i < 10_000; i++) {
            candidate = new File(dir, stem + " (" + i + ")" + ext);
            if (!candidate.exists()) return candidate;
        }
        return new File(dir, stem + "-" + System.currentTimeMillis() + ext);
    }

    private static String sanitizeFileName(String value) {
        String safe = value == null ? "" : value
            .replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_")
            .trim();
        if (safe.length() > 160) safe = safe.substring(0, 160).trim();
        return safe.isEmpty() ? "suno.bin" : safe;
    }

    private static String normalizeMime(String value) {
        if (value == null || !value.matches("^[A-Za-z0-9.+-]+/[A-Za-z0-9.+-]+$")) {
            return "application/octet-stream";
        }
        return value;
    }

    private static String readUtf8(InputStream stream) throws Exception {
        try (InputStream input = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) out.write(buffer, 0, read);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private String safeMessage(Exception e) {
        String message = e.getMessage();
        return message == null || message.trim().isEmpty() ? e.getClass().getSimpleName() : message;
    }

    private void resolveOnMain(PluginCall call, JSObject value) {
        if (destroyed) return;
        main.post(() -> {
            if (!destroyed) call.resolve(value);
        });
    }

    private void rejectOnMain(PluginCall call, String message) {
        if (destroyed) return;
        main.post(() -> {
            if (!destroyed) call.reject(message);
        });
    }

    @FunctionalInterface
    private interface HttpWork {
        HttpResult run() throws Exception;
    }

    private static final class HttpResult {
        final int status;
        final String body;

        HttpResult(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }

    private static final class Destination {
        final Uri collection;
        final String relativePath;

        Destination(Uri collection, String relativePath) {
            this.collection = collection;
            this.relativePath = relativePath;
        }
    }

    private static final class SaveSession {
        final String id;
        final OutputStream output;
        final Uri uri;
        final File file;
        final String displayPath;
        final String mime;
        final boolean mediaStore;
        volatile boolean closed;

        SaveSession(
            String id,
            OutputStream output,
            Uri uri,
            File file,
            String displayPath,
            String mime,
            boolean mediaStore
        ) {
            this.id = id;
            this.output = output;
            this.uri = uri;
            this.file = file;
            this.displayPath = displayPath;
            this.mime = mime;
            this.mediaStore = mediaStore;
        }
    }
}
