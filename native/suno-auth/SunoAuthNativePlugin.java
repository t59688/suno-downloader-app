package com.sunoapp.downloader.auth;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.Dialog;
import android.graphics.Color;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Pattern;

import javax.net.ssl.HttpsURLConnection;

/**
 * Android-only Suno authentication bridge.
 *
 * Security boundary:
 * - the user never sees or copies a token;
 * - the Suno session stays inside Android's WebView CookieManager;
 * - the native layer sends the bearer only to studio-api.prod.suno.com;
 * - JavaScript receives only { status, body } from the aligned-lyrics endpoint.
 */
@CapacitorPlugin(name = "SunoAuthNative")
public class SunoAuthNativePlugin extends Plugin {
    private static final Pattern UUID_RE = Pattern.compile(
        "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
    );
    private static final String SUNO_HOME = "https://suno.com";
    private static final String SUNO_SIGN_IN = "https://suno.com/sign-in";
    private static final String ALIGNED_BASE = "https://studio-api.prod.suno.com/api/gen/";
    private static final long AUTH_TIMEOUT_MS = 180_000L;
    private static final long AUTH_POLL_MS = 750L;

    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private final AtomicBoolean probeInFlight = new AtomicBoolean(false);
    private final Object stateLock = new Object();

    private PluginCall activeCall;
    private String activeContentId;
    private Dialog authDialog;
    private WebView authWebView;
    private String lastProbedToken;
    private boolean destroyed;

    private final Runnable authPoll = new Runnable() {
        @Override
        public void run() {
            if (!hasActiveCall() || authDialog == null || !authDialog.isShowing()) return;
            String token = readSessionToken();
            if (token != null && !token.isEmpty() && !token.equals(lastProbedToken)) {
                probeLoginToken(token);
            }
            main.postDelayed(this, AUTH_POLL_MS);
        }
    };

    private final Runnable authTimeout = () -> {
        if (hasActiveCall() && authDialog != null && authDialog.isShowing()) {
            rejectActive("Suno 登录超时，请重新点击 LRC 再试");
        }
    };

    @Override
    public void load() {
        main.post(() -> {
            CookieManager manager = CookieManager.getInstance();
            manager.setAcceptCookie(true);
        });
    }

    @Override
    protected void handleOnDestroy() {
        destroyed = true;
        main.removeCallbacksAndMessages(null);
        main.post(this::dismissAuthUi);
        io.shutdownNow();
        super.handleOnDestroy();
    }

    @PluginMethod
    public void alignedLyrics(PluginCall call) {
        String contentId = call.getString("contentId", "");
        if (!UUID_RE.matcher(contentId).matches()) {
            call.reject("歌曲 ID 无效，无法获取同步歌词");
            return;
        }

        synchronized (stateLock) {
            if (activeCall != null) {
                call.reject("已有 Suno 登录或歌词请求正在进行");
                return;
            }
            activeCall = call;
            activeContentId = contentId;
        }

        main.post(() -> {
            String token = readSessionToken();
            if (token == null || token.isEmpty()) {
                showLogin();
            } else {
                requestWithExistingSession(token);
            }
        });
    }

    @PluginMethod
    public void cancelAuth(PluginCall call) {
        main.post(() -> {
            rejectActive("已取消 Suno 登录");
            call.resolve();
        });
    }

    private void requestWithExistingSession(String token) {
        PluginCall call = getActiveCall();
        String contentId = getActiveContentId();
        if (call == null || contentId == null) return;

        io.execute(() -> {
            HttpResult result;
            try {
                result = requestAlignedLyrics(contentId, token);
            } catch (Exception e) {
                main.post(() -> {
                    if (isActive(call)) rejectActive("连接 Suno 失败，请检查网络后重试");
                });
                return;
            }

            main.post(() -> {
                if (!isActive(call)) return;
                if (result.status >= 200 && result.status < 300) {
                    resolveActive(result);
                } else if (result.status == 401 || result.status == 403) {
                    // Session is stale. Do not expose it to JS; refresh it inside the login WebView.
                    lastProbedToken = token;
                    showLogin();
                } else {
                    rejectActive("同步歌词请求失败 (HTTP " + result.status + ")");
                }
            });
        });
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void showLogin() {
        if (!hasActiveCall()) return;
        if (authDialog != null && authDialog.isShowing()) return;

        Activity activity = getActivity();
        if (activity == null || activity.isFinishing()) {
            rejectActive("无法打开 Suno 登录页");
            return;
        }

        lastProbedToken = readSessionToken();
        probeInFlight.set(false);

        Dialog dialog = new Dialog(activity);
        dialog.setCancelable(true);
        dialog.setCanceledOnTouchOutside(false);

        LinearLayout root = new LinearLayout(activity);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.rgb(9, 10, 12));

        LinearLayout bar = new LinearLayout(activity);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        int pad = dp(activity, 14);
        bar.setPadding(pad, dp(activity, 8), pad, dp(activity, 8));

        TextView title = new TextView(activity);
        title.setText("登录 Suno · 完成后自动返回");
        title.setTextColor(Color.WHITE);
        title.setTextSize(16);
        LinearLayout.LayoutParams titleParams = new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f);
        bar.addView(title, titleParams);

        Button cancel = new Button(activity);
        cancel.setText("取消");
        cancel.setOnClickListener(v -> rejectActive("已取消 Suno 登录"));
        bar.addView(cancel, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        root.addView(bar, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        WebView webView = new WebView(activity);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(true);
        settings.setSupportMultipleWindows(false);

        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.setAcceptCookie(true);
        cookieManager.setAcceptThirdPartyCookies(webView, true);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                String token = readSessionToken();
                if (token != null && !token.isEmpty() && !token.equals(lastProbedToken)) {
                    probeLoginToken(token);
                }
            }

            @Override
            public android.webkit.WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                captureBearer(request.getRequestHeaders());
                return super.shouldInterceptRequest(view, request);
            }
        });

        root.addView(webView, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f));
        dialog.setContentView(root);
        dialog.setOnCancelListener(d -> rejectActive("已取消 Suno 登录"));

        authDialog = dialog;
        authWebView = webView;
        dialog.show();
        Window window = dialog.getWindow();
        if (window != null) {
            window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        }

        webView.loadUrl(SUNO_SIGN_IN);
        main.removeCallbacks(authPoll);
        main.removeCallbacks(authTimeout);
        main.post(authPoll);
        main.postDelayed(authTimeout, AUTH_TIMEOUT_MS);
    }

    private void captureBearer(Map<String, String> headers) {
        if (headers == null || headers.isEmpty()) return;
        String value = null;
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if ("authorization".equalsIgnoreCase(entry.getKey())) {
                value = entry.getValue();
                break;
            }
        }
        if (value == null) return;
        String prefix = "Bearer ";
        if (!value.regionMatches(true, 0, prefix, 0, prefix.length())) return;
        String token = value.substring(prefix.length()).trim();
        if (token.isEmpty()) return;
        main.post(() -> {
            if (!token.equals(lastProbedToken)) probeLoginToken(token);
        });
    }

    private void probeLoginToken(String token) {
        if (!hasActiveCall() || token == null || token.isEmpty()) return;
        if (!probeInFlight.compareAndSet(false, true)) return;
        lastProbedToken = token;

        PluginCall call = getActiveCall();
        String contentId = getActiveContentId();
        if (call == null || contentId == null) {
            probeInFlight.set(false);
            return;
        }

        io.execute(() -> {
            HttpResult result;
            try {
                result = requestAlignedLyrics(contentId, token);
            } catch (Exception e) {
                main.post(() -> {
                    probeInFlight.set(false);
                    if (isActive(call)) rejectActive("登录成功，但连接 Suno 失败，请检查网络后重试");
                });
                return;
            }

            main.post(() -> {
                probeInFlight.set(false);
                if (!isActive(call)) return;
                if (result.status >= 200 && result.status < 300) {
                    CookieManager.getInstance().flush();
                    resolveActive(result);
                } else if (result.status == 401 || result.status == 403) {
                    // Keep the login UI open. The next refreshed __session / bearer will be probed automatically.
                } else {
                    rejectActive("登录成功，但同步歌词请求失败 (HTTP " + result.status + ")");
                }
            });
        });
    }

    private HttpResult requestAlignedLyrics(String contentId, String token) throws Exception {
        URL url = new URL(ALIGNED_BASE + contentId + "/aligned_lyrics/v2/");
        HttpsURLConnection connection = (HttpsURLConnection) url.openConnection();
        try {
            connection.setRequestMethod("GET");
            connection.setConnectTimeout(15_000);
            connection.setReadTimeout(30_000);
            connection.setUseCaches(false);
            connection.setRequestProperty("Accept", "application/json");
            connection.setRequestProperty("Authorization", "Bearer " + token);
            connection.setRequestProperty("Origin", SUNO_HOME);
            connection.setRequestProperty("Referer", SUNO_HOME + "/");
            connection.setRequestProperty("Cache-Control", "no-store");

            int status = connection.getResponseCode();
            InputStream stream = status >= HttpURLConnection.HTTP_BAD_REQUEST
                ? connection.getErrorStream()
                : connection.getInputStream();
            String body = stream == null ? "" : readUtf8(stream);
            return new HttpResult(status, body);
        } finally {
            connection.disconnect();
        }
    }

    private String readSessionToken() {
        CookieManager manager = CookieManager.getInstance();
        String token = extractLastSession(manager.getCookie(SUNO_HOME));
        if (token != null && !token.isEmpty()) return token;
        token = extractLastSession(manager.getCookie("https://www.suno.com"));
        return token;
    }

    private static String extractLastSession(String cookieHeader) {
        if (cookieHeader == null || cookieHeader.isEmpty()) return null;
        String found = null;
        for (String part : cookieHeader.split(";")) {
            String trimmed = part.trim();
            int eq = trimmed.indexOf('=');
            if (eq <= 0) continue;
            String name = trimmed.substring(0, eq).trim();
            if (!"__session".equals(name)) continue;
            String value = trimmed.substring(eq + 1).trim();
            if (value.length() >= 2 && value.startsWith("\"") && value.endsWith("\"")) {
                value = value.substring(1, value.length() - 1);
            }
            try {
                value = URLDecoder.decode(value, StandardCharsets.UTF_8.name());
            } catch (Exception ignored) {
                // JWT-style cookie values normally need no decoding.
            }
            if (!value.isEmpty()) found = value;
        }
        return found;
    }

    private static String readUtf8(InputStream stream) throws Exception {
        try (InputStream input = stream; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) out.write(buffer, 0, read);
            return out.toString(StandardCharsets.UTF_8.name());
        }
    }

    private void resolveActive(HttpResult result) {
        PluginCall call;
        synchronized (stateLock) {
            call = activeCall;
            activeCall = null;
            activeContentId = null;
        }
        dismissAuthUi();
        if (call == null) return;
        JSObject ret = new JSObject();
        ret.put("status", result.status);
        ret.put("body", result.body);
        call.resolve(ret);
    }

    private void rejectActive(String message) {
        PluginCall call;
        synchronized (stateLock) {
            call = activeCall;
            activeCall = null;
            activeContentId = null;
        }
        dismissAuthUi();
        if (call != null) call.reject(message);
    }

    private void dismissAuthUi() {
        main.removeCallbacks(authPoll);
        main.removeCallbacks(authTimeout);
        probeInFlight.set(false);
        lastProbedToken = null;

        WebView webView = authWebView;
        authWebView = null;
        if (webView != null) {
            try {
                webView.stopLoading();
                webView.loadUrl("about:blank");
                webView.clearHistory();
                webView.removeAllViews();
                webView.destroy();
            } catch (Exception ignored) {}
        }

        Dialog dialog = authDialog;
        authDialog = null;
        if (dialog != null && dialog.isShowing()) {
            try {
                dialog.setOnCancelListener(null);
                dialog.dismiss();
            } catch (Exception ignored) {}
        }
    }

    private PluginCall getActiveCall() {
        synchronized (stateLock) {
            return activeCall;
        }
    }

    private String getActiveContentId() {
        synchronized (stateLock) {
            return activeContentId;
        }
    }

    private boolean hasActiveCall() {
        synchronized (stateLock) {
            return activeCall != null && !destroyed;
        }
    }

    private boolean isActive(PluginCall call) {
        synchronized (stateLock) {
            return activeCall == call && !destroyed;
        }
    }

    private static int dp(Activity activity, int value) {
        return Math.round(value * activity.getResources().getDisplayMetrics().density);
    }

    private static final class HttpResult {
        final int status;
        final String body;

        HttpResult(int status, String body) {
            this.status = status;
            this.body = body;
        }
    }
}
