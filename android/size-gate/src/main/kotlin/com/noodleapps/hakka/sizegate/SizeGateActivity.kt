package com.noodleapps.hakka.sizegate

import android.app.Activity
import android.os.Bundle
import android.view.Gravity
import android.widget.TextView

class SizeGateActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val status = SizeGate.install(this)
        setContentView(
            TextView(this).apply {
                gravity = Gravity.CENTER
                text = "${SizeGate.name}\n$status"
                textSize = 18f
            },
        )
    }
}
