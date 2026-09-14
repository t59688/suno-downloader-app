package com.sunoapp.downloader.shell;

import android.app.Activity;
import android.graphics.Color;
import android.os.Build;
import android.view.Window;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsControllerCompat;

/**
 * Applies the app's edge-to-edge system bar treatment to Android windows.
 * Keeping this as tracked source makes clean CI builds reproduce the same
 * immersive shell as local builds.
 */
public final class SunoSystemUi {
    private SunoSystemUi() {}

    public static void apply(Activity activity) {
        if (activity == null) return;
        apply(activity.getWindow());
    }

    public static void apply(Window window) {
        if (window == null) return;

        WindowCompat.setDecorFitsSystemWindows(window, false);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.setStatusBarContrastEnforced(false);
            window.setNavigationBarContrastEnforced(false);
        }

        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(window, window.getDecorView());
        controller.setAppearanceLightStatusBars(false);
        controller.setAppearanceLightNavigationBars(false);
    }
}
