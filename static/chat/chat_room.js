const renderContext = JSON.parse(
	document.getElementById('render-context').textContent
)
const roomName = renderContext.room_name
const username = renderContext.username

let wsPingStartTime
let wsPingEndTime
let wsPings = []
let wsPingInterval
let wsMinPing
let wsMaxPing
let wsPong = false

let localAudioStream

const wsChatLog = document.getElementById('chat-log-websocket')
wsChatLog.scrollTop = wsChatLog.scrollHeight - wsChatLog.clientHeight
const wrtcChatLog = document.getElementById('chat-log-webrtc')
wrtcChatLog.scrollTop = wrtcChatLog.scrollHeight - wrtcChatLog.clientHeight

const wsChatInput = document.getElementById('chat-message-input-websocket')
wsChatInput.disabled = true
const wrtcChatInput = document.getElementById('chat-message-input-webrtc')
wrtcChatInput.disabled = true

const wsPingBtn = document.getElementById('ping-ws-btn')

const wsConnectionState = document.getElementById('websocket-connection-state')

const peerConnectionPool = {}
const remoteIceCandidatesBufferPool = {}
const wrtcRetryConnectionPool = {}
const htmlConnectedUser = {}
const wrtcPingVarPool = {}

const iceConfiguration = {
	iceServers: [{
		urls: 'stun:stun1.l.google.com:19302'
	}]
}

const wsScheme = window.location.protocol == "https:" ? "wss" : "ws";
const webSocket = new WebSocket(
	wsScheme + '://' + window.location.host +
	'/ws/chat/' + username + '/' + roomName + '/'
)

webSocket.onmessage = async e => {
	const data = JSON.parse(e.data)
	switch (data.type) {
		case 'pong':
			handleWebSocketPong()
			break

		case 'remote_ice_candidate':
			await handleRemoteIceCandidate(data)
			break

		case 'message':
			createMessage(data, wsChatLog)
			break

		case 'offer_connection':
			await handleReceivedOffer(data)
			break

		case 'answer_connection':
			handleReceivedAnswer(data)
			break

		case 'retry_connection':
			handleCreateConnection(data.user)
	}
}

function handleWebSocketPong() {
	wsPingEndTime = Date.now()
	let ping = wsPingEndTime - wsPingStartTime
	wsPings.push(ping)
	if (ping > wsMaxPing) {
		wsMaxPing = ping
	} else if (ping < wsMinPing) {
		wsMinPing = ping
	} else if (!wsMinPing) {
		wsMinPing = ping
		wsMaxPing = ping
	}
	if (wsPings.length >= 50) {
		clearInterval(wsPingInterval)
		wsPingInterval = undefined
		let wsAvgPing = wsPings.reduce((partial_sum, ping) => partial_sum + ping)
		wsAvgPing = Math.floor(wsAvgPing / wsPings.length)
		let pingString = username + ' | P MIN/AVG/MAX ' +
			wsMinPing + '/' + wsAvgPing + '/' + wsMaxPing
		webSocket.send(JSON.stringify({
			type: 'message',
			message: pingString
		}))
		wsPings = []
		wsMinPing = undefined
		wsMaxPing = undefined
		wsPingBtn.value = 'Ping WebSocket'
	}
}

webSocket.onclose = () => {
	console.error('WebSocket closed.')
	wsConnectionState.innerText = 'closed'
	wsChatInput.disabled = true
}

webSocket.onopen = () => {
	console.log('WebSocket connection opened.')
	wsConnectionState.innerText = 'open'
	wsChatInput.disabled = false
	wsChatInput.focus()
}

webSocket.onerror = e => {
	console.error('WebSocket error', e.error)
	wsConnectionState.innerText = 'on error'
}

wsPingBtn.onclick = () => {
	if (!wsPingInterval) {
		wsPingInterval = setInterval(() => {
			wsPingStartTime = Date.now()
			webSocket.send('{"type":"ping"}')
			if (wsPong) {
				wsPingBtn.value = 'pong'
				wsPong = false
			} else {
				wsPingBtn.value = 'ping'
				wsPong = true
			}
		}, 300)
	}
}

wsChatInput.onkeyup = e => {
	if (e.keyCode === 13) {  // enter, return
		const message = wsChatInput.value
		if (!message) return
		webSocket.send(JSON.stringify({
			type: 'message',
			message: message
		}))
		wsChatInput.value = ''
	}
}

wrtcChatInput.onkeyup = e => {
	if (e.keyCode === 13) {  // enter, return
		const message = wrtcChatInput.value
		if (!message) return
		data = {
			message: message,
			user: username
		}
		textData = JSON.stringify(data)
		Object.values(peerConnectionPool).forEach(pc => {
			pc.channel.send(textData)
		})
		wrtcChatInput.value = ''
		createMessage(data, wrtcChatLog)
	}
}

document.getElementById('webrtc-connection-button').onclick = () => {
	userToConnect = document.getElementById('webrtc-connection-text').value
	if (!userToConnect || userToConnect === username) return
	if (
		wrtcRetryConnectionPool[userToConnect] === undefined &&
		peerConnectionPool[userToConnect] === undefined
	) {
		handleCreateConnection(userToConnect)
	}
}

function createMessage(data, chatLog) {
	let p = document.createElement('p')
	let content = document.createTextNode(data.message)
	p.appendChild(content)
	p.classList.add('message')
	if (data.user === username) {
		p.classList.add('msg-right')
	} else {
		p.classList.add('msg-left')
	}
	chatLog.appendChild(p)
	chatLog.scrollTop = chatLog.scrollHeight - chatLog.clientHeight
}

function createConnectingUserItem(connectingUserUsername) {
	const htmlConnectedUserElements = {}
	const connectedUsersList = document.getElementById('webrtc-connected-user-list')
	const listItem = document.createElement('li')
	listItem.setAttribute('name', connectingUserUsername)
	listItem.classList.add('webrtc-connected-user-list-item')
	htmlConnectedUserElements.listItem = listItem

	const usernameSpan = document.createElement('span')
	usernameSpan.setAttribute('name', connectingUserUsername)
	usernameSpan.innerText = connectingUserUsername
	usernameSpan.classList.add('webrtc-connected-user-item')
	listItem.appendChild(usernameSpan)
	htmlConnectedUserElements.usernameSpan = usernameSpan

	const connectingSpan = document.createElement('span')
	connectingSpan.setAttribute('style', 'margin-right: 20px;')
	usernameSpan.classList.add('webrtc-connected-user-item')
	connectingSpan.innerText = 'Connecting...'
	listItem.appendChild(connectingSpan)
	htmlConnectedUserElements.connectingSpan = connectingSpan

	const localAudio = document.createElement('audio')
	localAudio.setAttribute('autoplay', "")
	localAudio.classList.add('webrtc-connected-user-item')
	listItem.appendChild(localAudio)
	htmlConnectedUserElements.localAudio = localAudio

	connectedUsersList.appendChild(listItem)
	htmlConnectedUser[connectingUserUsername] = htmlConnectedUserElements
}

function UpdateItemToConnectedUser(connectedUserUsername) {
	const htmlConnectedUserElements = htmlConnectedUser[connectedUserUsername]
	const listItem = htmlConnectedUserElements.listItem

	listItem.removeChild(htmlConnectedUserElements.connectingSpan)
	delete htmlConnectedUserElements.connectingSpan

	const volumeCtrl = document.createElement('input')
	volumeCtrl.setAttribute('type', 'range')
	volumeCtrl.setAttribute('min', 0)
	volumeCtrl.setAttribute('max', 1)
	volumeCtrl.setAttribute('step', 0.1)
	volumeCtrl.setAttribute('value', 0.8)
	volumeCtrl.setAttribute('name', 'volume-control')
	volumeCtrl.classList.add('webrtc-connected-user-item')
	volumeCtrl.localAudio = htmlConnectedUserElements.localAudio
	volumeCtrl.oninput = e => e.target.localAudio.volume = e.target.value
	listItem.appendChild(volumeCtrl)
	htmlConnectedUserElements.volumeCtrl = volumeCtrl

	const pingBtn = document.createElement('input')
	pingBtn.setAttribute('type', 'button')
	pingBtn.setAttribute('value', 'Ping WebRTC')
	pingBtn.setAttribute('name', 'ping-webrtc')
	pingBtn.classList.add('webrtc-connected-user-item')
	pingBtn.onclick = handleWebrtcPingBtn
	listItem.appendChild(pingBtn)
	htmlConnectedUserElements.pingBtn = pingBtn
}

function handleWebrtcPingBtn(e) {
	const user = e.target.parentElement.getAttribute('name')
	if (!wrtcPingVarPool[user].pingInterval && peerConnectionPool[user]) {
		wrtcPingVarPool[user].pings = []
		wrtcPingVarPool[user].pong = false
		wrtcPingVarPool[user].pingInterval = setInterval(user => {
			wrtcPingVarPool[user].startTime = Date.now()
			peerConnectionPool[user].channel.send('ping')
			if (wrtcPingVarPool[user].pong) {
				htmlConnectedUser[user].pingBtn.value = 'pong'
				wrtcPingVarPool[user].pong = false
			} else {
				htmlConnectedUser[user].pingBtn.value = 'ping'
				wrtcPingVarPool[user].pong = true
			}
		}, 300, user)
	}
}


async function handleCreateConnection(userToConnect) {
	if (wrtcRetryConnectionPool[userToConnect] === undefined) {
		wrtcRetryConnectionPool[userToConnect] = true
	}
	createConnectingUserItem(userToConnect)
	let peerConnection = await createPeerConnection(userToConnect)
	peerConnectionPool[userToConnect] = peerConnection
	setDataChannel({user: userToConnect, create: true})
	let offer = await peerConnection.createOffer()
	await peerConnection.setLocalDescription(offer)
	webSocket.send(JSON.stringify({
		type: 'offer',
		user: userToConnect,
		offer: offer
	}))
	console.log('Offer sent.')
}

async function handleReceivedOffer(data) {
	console.log('Offer received.')
	createConnectingUserItem(data.user)
	let peerConnection = await createPeerConnection(data.user)
	peerConnectionPool[data.user] = peerConnection
	setDataChannel({user: data.user})
	await peerConnection.setRemoteDescription(data.offer)
	while (remoteIceCandidatesBufferPool[data.user].length) {
		await handleRemoteIceCandidate({
			user: data.user,
			candidate: remoteIceCandidatesBufferPool[data.user].shift()
		})
	}
	const answer = await peerConnection.createAnswer()
	await peerConnection.setLocalDescription(answer)
	webSocket.send(JSON.stringify({
		type: 'answer',
		user: data.user,
		answer: answer
	}))
	console.log('Answer sent.')
}

function handleReceivedAnswer(data) {
	console.log('Answer received.')
	let peerConnection = peerConnectionPool[data.user]
	peerConnection.setRemoteDescription(data.answer)
		.then(() => {
			console.log('Remote description setted.')
			setTimeout(user => {
				let dataChannelClosed = peerConnection.channel.readyState != 'open'
				if (wrtcRetryConnectionPool[user] && dataChannelClosed) {
					console.log('Retrying connection.')
					webSocket.send(JSON.stringify({
						type: 'retry_connection',
						user: user
					}))
					peerConnectionPool[user].channel.close()
					wrtcRetryConnectionPool[user] = false
				} else {
					delete wrtcRetryConnectionPool[user]
				}
			}, 1000, data.user)
		})
}

async function handleRemoteIceCandidate(data) {
	const iceCandidate = new RTCIceCandidate(data.candidate)
	try {
		await peerConnectionPool[data.user].addIceCandidate(iceCandidate)
		console.log("+++ ICE candidate Added")
	} catch {
		console.log("+++ ICE candidate Pushed")
		remoteIceCandidatesBufferPool[data.user].push(iceCandidate)
	}
}

async function createAudioStreamWithFilter() {
	localAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
			autoGainControl: false,
			channelCount: 1,
			echoCancellation: false,
			latency: 0.01,
			noiseSuppression: false,
		},
        video: false
    })

	let audioCtx = new AudioContext({
		latencyHint: 0,
		sampleRate: 44100,
	})

	let source = new MediaStreamAudioSourceNode(audioCtx, {
		mediaStream: localAudioStream
	})
	source.channelCount = 1
	source.channelCountMode = 'explicit'
	source.channelInterpretation = 'discrete'

	let biquadFilter = new BiquadFilterNode(audioCtx, {
		type: "bandpass",
		frequency: 1650,
		q: 2700,
		channelCount: 1,
		channelCountMode: 'explicit',
		channelInterpretation: 'discrete',
	})

	wrtcLocalAudioStreamDestNode = new MediaStreamAudioDestinationNode(audioCtx, {
		channelCount: 1,
		channelCountMode: 'explicit',
		channelInterpretation: 'discrete'
	})

	source.connect(biquadFilter)
	biquadFilter.connect(wrtcLocalAudioStreamDestNode)

	wrtcLocalAudioTrack = wrtcLocalAudioStreamDestNode.stream.getAudioTracks()[0]
	peerConnection.addTrack(wrtcLocalAudioTrack, wrtcLocalAudioStreamDestNode.stream)
}

async function createAudioStream(peerConnection) {
	localAudioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
			autoGainControl: false,
			channelCount: 1,
			echoCancellation: true,
			latency: 0.01,
			noiseSuppression: true,
		},
        video: false
    })

	const wrtcLocalAudioTrack = localAudioStream.getAudioTracks()[0]
	peerConnection.addTrack(wrtcLocalAudioTrack, localAudioStream)
}

async function createPeerConnection(userToConnect) {
	let peerConnection = new RTCPeerConnection(iceConfiguration)
	peerConnection.remoteUser = userToConnect
	remoteIceCandidatesBufferPool[userToConnect] = []

	await createAudioStream(peerConnection)

	peerConnection.onicecandidate = e => {
		console.log('+++ New local ICE candidate.')
		if (e.candidate) {
			webSocket.send(JSON.stringify({
				type: 'ice_candidate',
				user: userToConnect,
				candidate: e.candidate
			}))
		} else {
			console.log('+++ End of candidates.')
		}
	}

	// peerConnection.oniceconnectionstatechange = () => {
		// connectionStates.wrtcIceConnectionState.innerText = peerConnection.iceConnectionState
	// }

	// peerConnection.onconnectionstatechange = () => {
		// connectionStates.wrtcConnectionState.innerText = peerConnection.connectionState
	// }

	peerConnection.ontrack = e => {
		htmlConnectedUser[userToConnect].localAudio.srcObject = e.streams[0]
	}

	return peerConnection
}

function handleWebRTCPong(user) {
	const pingEndTime = Date.now()
	const ping = pingEndTime - wrtcPingVarPool[user].startTime
	wrtcPingVarPool[user].pings.push(ping)
	if (ping > wrtcPingVarPool[user].maxPing) {
		wrtcPingVarPool[user].maxPing = ping
	} else if (ping < wrtcPingVarPool[user].minPing) {
		wrtcPingVarPool[user].minPing = ping
	} else if (!wrtcPingVarPool[user].minPing) {
		wrtcPingVarPool[user].minPing = ping
		wrtcPingVarPool[user].maxPing = ping
	}
	if (wrtcPingVarPool[user].pings.length >= 50) {
		clearInterval(wrtcPingVarPool[user].pingInterval)
		let pings = wrtcPingVarPool[user].pings 
		let minPing = wrtcPingVarPool[user].minPing
		let maxPing = wrtcPingVarPool[user].maxPing
		let avgPing = pings.reduce((partial_sum, ping) => partial_sum + ping)
		avgPing = Math.floor((avgPing / pings.length) / 2)
		minPing = Math.ceil(minPing / 2)
		maxPing = Math.floor(maxPing / 2)
		let latencyString = username + ' | L MIN/AVG/MAX ' +
			minPing + '/' + avgPing + '/' + maxPing
		webSocket.send(JSON.stringify({
			type: 'message',
			message: latencyString
		}))
		wrtcPingVarPool[user] = {}
		htmlConnectedUser[user].pingBtn.value = 'Ping WebRTC'
	}
}

const dataChannelEventHandlers = {
	onmessage: e => {
		switch (e.data) {
			case 'ping':
				e.target.send('pong')
				return 
			case 'pong':
				handleWebRTCPong(e.target.peerConnection.remoteUser)
				return
		}
		try {
			data = JSON.parse(e.data)
			createMessage(data, wrtcChatLog)
		} catch {
			console.log('WebRTC Messsage received: ', e.data)
		}
	},
	onopen: e => {
		console.log('Data channel connection opened.')
		const user = e.target.peerConnection.remoteUser
		UpdateItemToConnectedUser(user)
		wrtcChatInput.disabled = false
		wrtcChatInput.focus()
		wrtcPingVarPool[user] = {}
	},
	onclose: e => {
		console.error('Data Channel connection closed.')
		const user = e.target.peerConnection.remoteUser
		const connectedUsersList = document.getElementById('webrtc-connected-user-list')
		connectedUsersList.removeChild(htmlConnectedUser[user].listItem)
		delete htmlConnectedUser[user]
		peerConnectionPool[user].close()
		delete e.target
		delete peerConnectionPool[user]
		wrtcChatInput.disabled = true
	},
	onerror: e => {
		console.error('Data channel error: ', e.error)
	}
}

function setDataChannel(data) {
	const create = data.create ? true : false 
	let peerConnection = peerConnectionPool[data.user]
	if (peerConnection.channel) {
		if (peerConnection.channel.readyState !== 'closed' &&
			peerConnection.channel.readyState !== 'closing') {

			peerConnection.channel.close()
		}
	}
	if (create) {
		peerConnection.channel = peerConnection.createDataChannel('PeerDataChannel')
		peerConnection.channel.peerConnection = peerConnection
		setDataChannelHandlers(peerConnection)
	} else {
		peerConnection.ondatachannel = e => {
			e.target.channel = e.channel
			e.target.channel.peerConnection = e.target
			setDataChannelHandlers(e.target)
		}
	}
}

function setDataChannelHandlers(peerConnection) {
	peerConnection.channel.onmessage = dataChannelEventHandlers.onmessage
	peerConnection.channel.onopen = dataChannelEventHandlers.onopen
	peerConnection.channel.onclose = dataChannelEventHandlers.onclose
	peerConnection.channel.onerror = dataChannelEventHandlers.onerror
}
