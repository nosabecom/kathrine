package expo.modules.kathrineplayback
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.functions.Queues
import org.json.JSONObject
class KathrinePlaybackModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KathrinePlayback")
    AsyncFunction("inspect") { mediaJson: String ->
      val activity = appContext.currentActivity ?: throw IllegalStateException("Playback capability inspection requires a visible activity.")
      Capabilities.inspect(activity, JSONObject(mediaJson)).toString()
    }.runOnQueue(Queues.MAIN)
  }
}
