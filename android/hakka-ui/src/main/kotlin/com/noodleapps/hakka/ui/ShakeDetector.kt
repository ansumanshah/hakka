package com.noodleapps.hakka.ui

import android.content.Context
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import kotlin.math.sqrt

/**
 * Detects shake gestures to open the Hakka network inspector.
 *
 * Uses accelerometer to detect rapid device movement.
 * Triggers callback when shake threshold is exceeded twice within cooldown.
 */
class ShakeDetector(
    private val context: Context,
    private val onShake: () -> Unit
) : SensorEventListener {

    companion object {
        private const val SHAKE_THRESHOLD = 12.0
        private const val SHAKE_COOLDOWN = 500
        private const val SHAKE_COUNT_THRESHOLD = 2
    }

    private var sensorManager: SensorManager? = null
    private var accelerometer: Sensor? = null
    private var lastShakeTime = 0L
    private var shakeCount = 0

    fun start() {
        sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
        accelerometer = sensorManager?.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)
        accelerometer?.let { sensor ->
            sensorManager?.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI)
        }
    }

    fun stop() {
        sensorManager?.unregisterListener(this)
        shakeCount = 0
    }

    override fun onSensorChanged(event: SensorEvent?) {
        event?.let { sensorEvent ->
            if (sensorEvent.sensor.type == Sensor.TYPE_ACCELEROMETER) {
                val x = sensorEvent.values[0]
                val y = sensorEvent.values[1]
                val z = sensorEvent.values[2]
                val acceleration = sqrt((x * x + y * y + z * z).toDouble()) - SensorManager.GRAVITY_EARTH
                if (acceleration > SHAKE_THRESHOLD) {
                    val currentTime = System.currentTimeMillis()
                    if (currentTime - lastShakeTime < SHAKE_COOLDOWN) return
                    shakeCount++
                    lastShakeTime = currentTime
                    if (shakeCount >= SHAKE_COUNT_THRESHOLD) {
                        shakeCount = 0
                        onShake()
                    }
                }
            }
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
}
