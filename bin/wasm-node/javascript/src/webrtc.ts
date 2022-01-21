// Smoldot
// Copyright (C) 2019-2022  Parity Technologies (UK) Ltd.
// SPDX-License-Identifier: GPL-3.0-or-later WITH Classpath-exception-2.0

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.

// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.

// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

// # Overview
//
// ## ICE
//
// RFCs: 8839, 8845
// See also: https://tools.ietf.org/id/draft-ietf-rtcweb-sdp-08.html#rfc.section.5.2.3
//
// The WebRTC protocol uses ICE in order to establish a connection.
//
// In a typical ICE setup, there are two endpoints, called agents, that want to communicate. One
// of these two agents is the local browser, while the other agent is the target of the
// connection.
//
// Even though in this specific context all we want is a simple client-server communication, it
// is helpful to keep in mind that ICE was designed to solve the problem of NAT traversal.
//
// The ICE workflow works as follows:
//
// - An "offerer" (the local browser) determines ways in which it could be accessible (either an
//   IP address or through a relay using a TURN server), which are called "candidates". It then
//   generates a small text payload in a format called SDP, that describes the request for a
//   connection.
// - The offerer sends this SDP-encoded message to the answerer. The medium through which this
//   exchange is done is out of scope of the ICE protocol.
// - The answerer then finds its own candidates, and generates an answer, again in the SDP format.
//   This answer is sent back to the offerer.
// - Each agent then tries to connect to the remote's candidates.
//
// The code below only runs on one of the two agents, and simulates steps 2 and 3.
// We pretend to send the offer to the remote agent (the target of the connection), then pretend
// that it has found a valid IP address for itself (i.e. a candidate), then pretend that the SDP
// answer containing this candidate has been sent back.
// This will cause the browser to execute step 4: try to connect to the remote's candidate.
//
// This process involves parsing the offer generated by the browser in order for the answer to
// match the browser's demands.
//
// ## TCP or UDP
//
// The SDP message generated by the offerer contains the list of so-called "media streams" that it
// wants to open. In our specific use-case, we configure the browser to always request one data
// stream.
//
// WebRTC by itself doesn't hardcode any specific protocol for these media streams. Instead, it is
// the SDP message of the offerer that specifies which protocol to use. In our use case, one data
// stream, we know that the browser will always request either TCP+DTLS+SCTP, or UDP+DTLS+SCTP.
//
// After the browser generates an SDP offer (by calling `createOffer`), we are allowed to tweak
// the actual SDP payload that we pass to `setLocalDescription` and that the browser will actually
// end up using for its local description. Thanks to this, we can force the browser to use TCP
// or to use UDP, no matter which one of the two it has requested in its offer.
//
// ## DTLS+SCTP
//
// RFC: https://datatracker.ietf.org/doc/html/rfc8841
//
// In both cases (TCP or UDP), the next layer is DTLS. DTLS is similar to the well-known TLS
// protocol, except that it doesn't guarantee ordering of delivery (as this is instead provided
// by the SCTP layer on top of DTLS). In other words, once the TCP or UDP connection is
// established, the browser will try to perform a DTLS handshake.
//
// During the ICE negotiation, each agent must include in its SDP packet a hash of the self-signed
// certificate that it will use during the DTLS handshake.
// In our use-case, where we try to hand-crate the SDP answer generated by the remote, this is
// problematic as at this stage we have no way to know the certificate that the remote is going
// to use.
//
// To solve that problem, instead of generating a random certificate, like you normally would, the
// certificate is instead generated deterministically using the `PeerId` of the remote as a seed.
// Because the `PeerId` is a public information, the certificate (and its private key) is also a
// public information. As such, this certificate won't offer any protection and another encryption
// layer will need to be negotiated on top of the DTLS+SCTP stream, like is the case for plain
// TCP connections.
//
// TODO: this is only one potential solution; see ongoing discussion in https://github.com/libp2p/specs/issues/220
// # About main thread vs worker
//
// You might wonder why this code is not executed within the WebWorker.
// The reason is that at the time of writing it is not allowed to create WebRTC connections within
// a WebWorker.
//
// See also https://github.com/w3c/webrtc-extensions/issues/64
//

const webrtc = new RTCPeerConnection();
webrtc.createDataChannel("data", { ordered: true, negotiated: true, id: 0 });

webrtc.addEventListener("negotiationneeded", async (_event) => {
    const offer = await webrtc.createOffer();
    // TODO: just for testing; this substitution must be done properly
    //const tweaked = offer.sdp?.replace('UDP', 'TCP');
    await webrtc.setLocalDescription({ type: "offer", sdp: offer.sdp });

    console.log(webrtc.localDescription!.sdp);

    const remoteSdp = "v=0" + "\n" +
        "o=- " + (Date.now() / 1000).toFixed() + " 0 IN IP4 0.0.0.0" + "\n" +
        "s=-" + "\n" +
        "t=0 0" + "\n" +
        "a=group:BUNDLE 0" + "\n" +
        // TODO: MUST use the value contained in the offer
        "m=application 41000 UDP/DTLS/SCTP webrtc-datachannel" + "\n" +
        "c=IN IP4 127.0.0.1" + "\n" +
        "a=mid:0" + "\n" +
        "a=sendrecv" + "\n" +
        "a=ice-options:ice2" + "\n" +
        "a=ice-pwd:asd88fgpdd777uzjYhagZg" + "\n" +
        "a=ice-ufrag:8hhY" + "\n" +
        "a=fingerprint:sha-256 39:60:F3:A0:32:3E:17:B5:34:CE:61:07:51:FB:F3:7E:7B:32:9F:DC:69:1F:C4:B5:0A:38:3C:FC:A6:0D:91:0A" + "\n" +
        "a=tls-id:1111111111111" + "\n" +  // TODO:
        "a=setup:passive" + "\n" +  // Indicates that the remote DTLS server will only listen for incoming connections. (RFC5763)
        "a=sctp-port:5000" + "\n" +
        "a=max-message-size:100000" + "\n" +
        "a=candidate:0 1 UDP 2113667327 127.0.0.1 41000 typ host" + "\n";
    webrtc.setRemoteDescription({ type: "answer", sdp: remoteSdp });
});
