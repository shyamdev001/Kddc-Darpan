package `in`.kdcc.darpan

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.util.Log

/**
 * Tells the app when the network comes back after it was gone (docs/AUDIT.md, OF7), so the live
 * link and the sync try at once instead of waiting out their backoff (up to ~90 s for the link,
 * 10 min for the sync). Works on Android 6 (API 23) and later.
 */
class NetworkWatch(context: Context, private val onBack: () -> Unit) {
    private val cm = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
    private val edges = NetworkEdges<Network>()

    private val callback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            if (edges.available(network)) onBack()
        }

        override fun onLost(network: Network) {
            edges.lost(network)
        }
    }

    fun start() {
        try {
            val request = NetworkRequest.Builder().addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET).build()
            cm.registerNetworkCallback(request, callback)
        } catch (e: Exception) {
            Log.w(TAG, "Cannot watch the network; the usual retries still apply", e)
        }
    }

    fun stop() {
        try {
            cm.unregisterNetworkCallback(callback)
        } catch (e: Exception) {
            // never registered
        }
    }

    private companion object {
        const val TAG = "NetworkWatch"
    }
}

/**
 * The rule behind [NetworkWatch], without Android: "back" means a network appeared after every
 * network had been lost. The networks already there when watching starts do not count.
 */
class NetworkEdges<N> {
    private val up = mutableSetOf<N>()
    private var down = false

    /** True when this network ends a time with no network at all. */
    @Synchronized
    fun available(n: N): Boolean {
        val back = down && up.isEmpty()
        up += n
        if (back) down = false
        return back
    }

    @Synchronized
    fun lost(n: N) {
        up -= n
        if (up.isEmpty()) down = true
    }
}
