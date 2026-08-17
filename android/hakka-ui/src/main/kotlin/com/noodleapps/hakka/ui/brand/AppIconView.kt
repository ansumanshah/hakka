package com.noodleapps.hakka.ui.brand

import android.animation.ValueAnimator
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.RectF
import android.graphics.Shader
import android.util.AttributeSet
import android.view.View
import android.view.animation.LinearInterpolator
import com.noodleapps.hakka.ui.GeneratedTokens
import kotlin.math.min
import kotlin.math.sin

class AppIconView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
    defStyleAttr: Int = 0,
) : View(context, attrs, defStyleAttr) {
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val path = Path()
    private var phase = 0f

    private val animator = ValueAnimator.ofFloat(0f, 1f).apply {
        duration = 1600L
        repeatCount = ValueAnimator.INFINITE
        interpolator = LinearInterpolator()
        addUpdateListener {
            phase = it.animatedValue as Float
            invalidate()
        }
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        if (!animator.isStarted) animator.start()
    }

    override fun onDetachedFromWindow() {
        animator.cancel()
        super.onDetachedFromWindow()
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val desired = (96 * resources.displayMetrics.density).toInt()
        val width = resolveSize(desired, widthMeasureSpec)
        val height = resolveSize(desired, heightMeasureSpec)
        val side = min(width, height)
        setMeasuredDimension(side, side)
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val side = min(width, height).toFloat()
        val s = side / 64f
        val pulse = 0.5f + 0.5f * sin(phase * Math.PI.toFloat() * 2f)
        val cx = side * 0.5f
        val cy = side * 0.38f

        // Broadcast fan — jade (status-success token), pulsing while capturing.
        val jade = Color.parseColor(GeneratedTokens.statusSuccess)
        paint.style = Paint.Style.STROKE
        paint.strokeCap = Paint.Cap.ROUND
        for (index in 0..2) {
            val radius = (7f + index * 6f + pulse * 4f) * s
            paint.color = Color.argb(
                (230 - index * 56).coerceAtLeast(80),
                Color.red(jade), Color.green(jade), Color.blue(jade),
            )
            paint.strokeWidth = 1.7f * s
            canvas.drawArc(RectF(cx - radius, cy - radius, cx + radius, cy + radius), 200f, 140f, false, paint)
        }

        paint.color = Color.argb(158, 255, 255, 255)
        paint.strokeWidth = 2f * s
        canvas.drawLine(side * 0.65f, side * 0.39f, side * 0.79f, side * 0.18f, paint)
        canvas.drawLine(side * 0.72f, side * 0.41f, side * 0.84f, side * 0.27f, paint)

        // Bowl — flame accent, fixed to the dark-ground variant since the mark renders on
        // warm graphite chrome (title bars, splash) regardless of the host app's theme.
        val flameDark = Color.parseColor(GeneratedTokens.darkAccent)
        val bowl = RectF(side * 0.12f, side * 0.40f, side * 0.88f, side * 0.84f)
        paint.style = Paint.Style.FILL
        paint.shader = LinearGradient(
            0f, bowl.top, 0f, bowl.bottom,
            blend(flameDark, Color.WHITE, 0.18f), flameDark,
            Shader.TileMode.CLAMP,
        )
        canvas.drawOval(bowl, paint)
        paint.shader = null

        paint.style = Paint.Style.STROKE
        paint.color = blend(flameDark, Color.WHITE, 0.35f)
        paint.strokeWidth = 3.2f * s
        canvas.drawLine(side * 0.10f, side * 0.42f, side * 0.90f, side * 0.42f, paint)

        paint.color = Color.argb(122, 255, 255, 255)
        paint.strokeWidth = 1f * s
        repeat(2) { row ->
            val y = side * 0.52f + row * 5f * s
            path.reset()
            path.moveTo(side * 0.28f, y)
            path.quadTo(side * 0.50f, y + if (row == 0) 4f * s else -3f * s, side * 0.72f, y)
            canvas.drawPath(path, paint)
        }
    }

    /** Blend two opaque colors by a fraction (0..1) — used for the bowl's flame gradient/rim. */
    private fun blend(base: Int, overlay: Int, fraction: Float): Int {
        val r = Color.red(base) + ((Color.red(overlay) - Color.red(base)) * fraction).toInt()
        val g = Color.green(base) + ((Color.green(overlay) - Color.green(base)) * fraction).toInt()
        val b = Color.blue(base) + ((Color.blue(overlay) - Color.blue(base)) * fraction).toInt()
        return Color.rgb(r.coerceIn(0, 255), g.coerceIn(0, 255), b.coerceIn(0, 255))
    }
}
