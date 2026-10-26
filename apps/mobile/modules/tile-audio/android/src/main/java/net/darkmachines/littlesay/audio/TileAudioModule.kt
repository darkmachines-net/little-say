/** Plays Android tile clips with an owned ExoPlayer, without publishing a MediaSession. */
package net.darkmachines.littlesay.audio

import android.os.Handler
import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Owns one foreground clip; all player access and lifecycle cleanup run on Android's main thread. */
@androidx.annotation.OptIn(UnstableApi::class)
class TileAudioModule : Module() {
  private val main = Handler(Looper.getMainLooper())
  private var player: ExoPlayer? = null
  private var listener: Player.Listener? = null
  private var requestId: String? = null
  private var foreground = true
  private var destroyed = false

  /** Exposes request-scoped playback, cancellation, and load/terminal events to the speech driver. */
  override fun definition() = ModuleDefinition {
    Name("LittleSayTileAudio")
    Events("playbackStatus")

    AsyncFunction("play") { id: String, uri: String ->
      check(!destroyed && foreground) { "Tile audio requires a foreground activity." }
      val context = requireNotNull(appContext.reactContext) { "React context is unavailable." }
      releasePlayer()
      val clip = ExoPlayer.Builder(context)
        .setLooper(Looper.getMainLooper())
        .setAudioAttributes(
          AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.AUDIO_CONTENT_TYPE_SPEECH)
            .build(),
          true
        )
        .setHandleAudioBecomingNoisy(true)
        .build()
      player = clip
      requestId = id
      val events = object : Player.Listener {
        /** Report readiness once buffered; release the player before delivering completion. */
        override fun onPlaybackStateChanged(state: Int) {
          if (requestId != id) return
          when (state) {
            Player.STATE_READY -> status(id, "ready")
            Player.STATE_ENDED -> finish(id, "ended")
          }
        }

        /** Release failed decoders before JavaScript starts the system-speech fallback. */
        override fun onPlayerError(error: PlaybackException) {
          finish(id, "error")
        }
      }
      listener = events
      clip.addListener(events)
      try {
        clip.setMediaItem(MediaItem.fromUri(uri))
        clip.prepare()
        clip.play()
      } catch (error: Exception) {
        releasePlayer()
        throw error
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("stop") { id: String ->
      // A delayed cancellation must never stop a newer request.
      if (requestId == id) releasePlayer()
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersBackground {
      onMain {
        foreground = false
        // PlayBoard also cancels its JS queue; do not start fallback speech in the background.
        releasePlayer()
      }
    }
    OnActivityEntersForeground { onMain { foreground = true } }
    OnDestroy {
      onMain {
        destroyed = true
        releasePlayer()
      }
    }
  }

  private fun status(id: String, state: String) {
    sendEvent("playbackStatus", mapOf("id" to id, "state" to state))
  }

  private fun finish(id: String, state: String) {
    if (requestId != id) return
    releasePlayer()
    status(id, state)
  }

  private fun releasePlayer() {
    val clip = player
    val events = listener
    player = null
    listener = null
    requestId = null
    if (clip != null) {
      if (events != null) clip.removeListener(events)
      clip.release()
    }
  }

  private fun onMain(action: () -> Unit) {
    if (Looper.myLooper() == Looper.getMainLooper()) action() else main.post { action() }
  }
}
