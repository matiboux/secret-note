<script lang="ts">
import { onMount } from 'svelte'
import { persistentAtom } from '@nanostores/persistent'

import { sizeToString } from '~/util/sizeToString'
import { hashToColor, hashToEmojis } from '~/util/convertHash'
import { readFileData } from '~/util/readFileData'

// Props
let userClass: string | undefined = undefined
let style: string | undefined = undefined
let locale: string | undefined = undefined
export {
	userClass as class,
	style,
	locale,
}

import { i18nFactory } from '~/i18n'
const _ = i18nFactory(locale as any)

// State types
type PublicKeyEncodedType = string
const copiedItemTypes = {
	copyPublicKey: 'copyPublicKey',
	copyShareLink: 'copyShareLink',
	copyShareText: 'copyShareText',
	pastePeerPublicKey: 'pastePeerPublicKey',
	clearPeerPublicKey: 'clearPeerPublicKey',
	copySubmittedPayload: 'copySubmittedPayload',
	pasteInputText: 'pasteInputText',
}
type CopiedItemType = keyof typeof copiedItemTypes
const processTypes = {
	encryption: 'Encryption',
	decryption: 'Decryption',
}
type ProcessType = keyof typeof processTypes
const inputTypes = {
	textInput: 'Text Input',
	fileInput: 'File Input',
}
type InputType = keyof typeof inputTypes

// State input data
let keyPair: CryptoKeyPair | null = null
let publicKeyEncoded: PublicKeyEncodedType | null = null
let publicKeyHash: string | null = null
let publicKeyColor: string | null = null
let publicKeyEmojis: string | null = null
let peerPublicKeyEncoded: PublicKeyEncodedType | null = null
let peerPublicKeyHash: string | null = null
let peerPublicKeyColor: string | null = null
let peerPublicKeyEmojis: string | null = null
let derivedKey: CryptoKey | null = null
let copiedItem: CopiedItemType | null = null
let copiedItemClearTimeout: ReturnType<typeof setTimeout> | null = null
const processType = persistentAtom<ProcessType>('processType', 'encryption')
const inputType = persistentAtom<InputType>('inputType', 'textInput')
let inputText: string = ''
let secretFileElement: HTMLInputElement | null = null
let selectedFileName: string | null = null
let secretPayload: Uint8Array | null = null
let submittedPayload: Uint8Array | null = null

let logMessage: string | null = null
let errorMessage: string | null = null

const submittedPayloadMaxDisplaySize = 1048576 // = 1 MiB = 1024 * 1024 bytes
const submittedPayloadMaxCopySize = 16777216 // = 16 MiB = 16 * 1024 * 1024 bytes

onMount(() =>
{
	generateKeyPair()

	loadPeerPublicKeyFromUrlHash()

	window.addEventListener('hashchange', () =>
	{
		loadPeerPublicKeyFromUrlHash()
	})
})

async function publicKeyToHash(publicKey: PublicKeyEncodedType): Promise<string>
{
	const encoder = new TextEncoder()
	const data = encoder.encode(publicKey)
	const hashBuffer = await window.crypto.subtle.digest('SHA-256', data)

	if (Uint8Array.prototype.toHex)
	{
		return (new Uint8Array(hashBuffer)).toHex()
	}

	return Array.from(new Uint8Array(hashBuffer))
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
}

async function generateKeyPair()
{
	resetDerivedKey()

	// Generate a key pair for the session
	keyPair = await window.crypto.subtle.generateKey(
		{
			name: 'ECDH', // Elliptic Curve Diffie-Hellman, for key agreement
			namedCurve: 'P-521', // Can be 'P-256', 'P-384', or 'P-521'
		},
		false,
		['deriveKey'],
	)

	generateDerivedKey()

	// Export the public key as base64-encoded JWK
	const publicKeyJWT = await window.crypto.subtle.exportKey(
		'jwk',
		keyPair.publicKey,
	)
	publicKeyEncoded = btoa(JSON.stringify(publicKeyJWT))

	// Export the public key as base64-encoded JWK
	publicKeyHash = await publicKeyToHash(publicKeyEncoded)
	publicKeyColor = hashToColor(publicKeyHash)
	publicKeyEmojis = hashToEmojis(publicKeyHash)
}

async function setPeerPublicKey(value: string | null)
{
	resetDerivedKey()

	peerPublicKeyEncoded = null
	peerPublicKeyHash = null
	peerPublicKeyColor = null
	peerPublicKeyEmojis = null

	if (!value)
	{
		appLog('Peer public key cleared.')
		return
	}

	try
	{
		if (value.startsWith('http'))
		{
			// Try to extract the url hash part
			const url = new URL(value)
			value = url.hash.slice(1)
		}

		if (value.startsWith('pubkey:'))
		{
			peerPublicKeyEncoded = value.slice('pubkey:'.length)
		}
		else
		{
			// Try to decode base64-encoded JWK
			const decoded = atob(value)
			const jwk = JSON.parse(decoded)
			if (jwk.kty === 'EC' && jwk.crv === 'P-521' && jwk.x && jwk.y)
			{
				peerPublicKeyEncoded = value
			}
		}
	}
	catch (error)
	{
		console.error('Error parsing peer public key:', error, value)
		appError(`Error parsing peer public key: ${error instanceof Error ? error.message : String(error)}`)
		return
	}

	if (!peerPublicKeyEncoded)
	{
		appError('Invalid public key format.')
		return
	}

	generateDerivedKey()

	peerPublicKeyHash = await publicKeyToHash(peerPublicKeyEncoded)
	peerPublicKeyColor = hashToColor(peerPublicKeyHash)
	peerPublicKeyEmojis = hashToEmojis(peerPublicKeyHash)

	appLog('Peer public key set.')
}

function loadPeerPublicKeyFromUrlHash()
{
	resetDerivedKey()

	setPeerPublicKey(window.location.hash.slice(1))
}

function clearPeerPublicKey()
{
	setCopiedItem(null)

	setPeerPublicKey(null)

	setCopiedItem('clearPeerPublicKey')
}

async function resetDerivedKey()
{
	resetPayload()

	derivedKey = null
}

async function generateDerivedKey()
{
	if (!keyPair || !peerPublicKeyEncoded)
	{
		derivedKey = null
		return
	}

	resetPayload()

	const peerPublicCryptoKey = await window.crypto.subtle.importKey(
		'jwk',
		JSON.parse(atob(peerPublicKeyEncoded)),
		{
			name: 'ECDH',
			namedCurve: 'P-521',
		},
		false,
		[],
	)

	derivedKey = await window.crypto.subtle.deriveKey(
		{
			name: "ECDH",
			public: peerPublicCryptoKey,
		},
		keyPair.privateKey,
		{
			name: "AES-GCM",
			length: 256,
		},
		false,
		['encrypt', 'decrypt'],
	)
}

function setCopiedItem(item: CopiedItemType | null)
{
	if (copiedItemClearTimeout)
	{
		clearTimeout(copiedItemClearTimeout)
		copiedItemClearTimeout = null
	}

	copiedItem = item

	if (item)
	{
		copiedItemClearTimeout = setTimeout(() => {
			copiedItem = null
			copiedItemClearTimeout = null
		}, 2000)
	}
}

async function copyPublicKeyToClipboard()
{
	if (!publicKeyEncoded)
	{
		appError('No public key available to copy.')
		return
	}

	setCopiedItem(null)

	try
	{
		await navigator.clipboard.writeText(publicKeyEncoded)
	}
	catch (error)
	{
		appError(`Error copying public key: ${error instanceof Error ? error.message : String(error)}`)
	}

	setCopiedItem('copyPublicKey')
}

async function copyShareLinkToClipboard()
{
	if (!publicKeyEncoded)
	{
		appError('No public key available to generate share link.')
		return
	}

	setCopiedItem(null)

	const shareLink = `${window.location.origin}${window.location.pathname}#pubkey:${publicKeyEncoded}`

	try
	{
		await navigator.clipboard.writeText(shareLink)
		appLog('Share link copied to clipboard.')
	}
	catch (error)
	{
		appError(`Error copying share link: ${error instanceof Error ? error.message : String(error)}`)
	}

	setCopiedItem('copyShareLink')
}

async function copyShareTextToClipboard()
{
	if (!publicKeyEncoded)
	{
		appError('No public key available to generate share text.')
		return
	}

	setCopiedItem(null)

	const shareLink = `${window.location.origin}${window.location.pathname}#pubkey:${publicKeyEncoded}`
	const shareText = (
		'Hi! I\'d like to share a secret note with you. ' +
		'Here\'s the link with my public key so you can make sure it\'s from me. ' +
		'I\'ll just need your public key to encrypt the message for you.\n\n' +
		shareLink
	)

	try
	{
		await navigator.clipboard.writeText(shareText)
		appLog('Share text copied to clipboard.')
	}
	catch (error)
	{
		appError(`Error copying share text: ${error instanceof Error ? error.message : String(error)}`)
	}

	setCopiedItem('copyShareText')
}

async function pastePeerPublicKey()
{
	setCopiedItem(null)

	let text: string

	try
	{
		text = await navigator.clipboard.readText()
	}
	catch (error)
	{
		appError(`Error reading from clipboard: ${error instanceof Error ? error.message : String(error)}`)
		return
	}

	setPeerPublicKey(text)

	setCopiedItem('pastePeerPublicKey')
}

function switchToEncryptionMode()
{
	if ($processType === 'encryption')
	{
		return
	}

	processType.set('encryption')

	reset()
}

function switchToDecryptionMode()
{
	if ($processType === 'decryption')
	{
		return
	}

	processType.set('decryption')

	reset()
}

function switchToTextInput()
{
	if ($inputType === 'textInput')
	{
		return
	}

	inputType.set('textInput')

	resetPayload()
}

function switchToFileInput()
{
	if ($inputType === 'fileInput')
	{
		return
	}

	inputType.set('fileInput')

	if (secretFileElement)
	{
		secretFileElement.value = ''
	}

	selectedFileName = null

	resetPayload()
}

async function pasteInputText()
{
	setCopiedItem(null)

	try
	{
		inputText = await navigator.clipboard.readText()
	}
	catch (error)
	{
		appError(`Error reading from clipboard: ${error instanceof Error ? error.message : String(error)}`)
		return
	}

	setCopiedItem('pasteInputText')

	submitPayload()
}

async function readSecretFile(): Promise<void>
{
	if (!secretFileElement || !secretFileElement.files || secretFileElement.files.length < 1)
	{
		return
	}

	selectedFileName = null
	secretPayload = null

	try
	{
		selectedFileName = secretFileElement.files[0]!.name
		secretPayload = await readFileData(secretFileElement.files[0]!)
		submitPayload()
	}
	catch (error)
	{
		appError(`Error reading file: ${error instanceof Error ? error.message : String(error)}`)
	}
}

async function submitPayload()
{
	if (!derivedKey)
	{
		appError('No derived key available for encryption.')
		return
	}

	if ($inputType === 'textInput')
	{
		if (!inputText)
		{
			appError('No secret message to encrypt.')
			return
		}

		if ($processType === 'decryption')
		{
			try
			{
				const decoded = atob(inputText)
				secretPayload = new Uint8Array(decoded.length)
				for (let i = 0; i < decoded.length; ++i)
				{
					secretPayload[i] = decoded.charCodeAt(i)
				}
			}
			catch (error)
			{
				appError(`Error decoding encrypted payload: ${error instanceof Error ? error.message : String(error)}`)
				return
			}
		}
		else
		{
			try
			{
				const encoder = new TextEncoder()
				secretPayload = encoder.encode(inputText)
			}
			catch (error)
			{
				appError(`Error encoding secret message: ${error instanceof Error ? error.message : String(error)}`)
				return
			}
		}
	}

	if ($processType === 'decryption')
	{
		if (!secretPayload)
		{
			appError('No encrypted payload to decrypt.')
			return
		}

		try
		{
			const decryptedBuffer = await window.crypto.subtle.decrypt(
				{
					name: 'AES-GCM',
					iv: secretPayload.slice(0, 12), // The first 12 bytes are the IV
				},
				derivedKey,
				secretPayload.slice(12), // The rest is the ciphertext
			)

			submittedPayload = new Uint8Array(decryptedBuffer)

			appLog('Message decrypted successfully.')
		}
		catch (error)
		{
			appError(`Error decrypting message: ${error instanceof Error ? error.message : String(error)}`)
		}
	}
	else
	{
		if (!secretPayload)
		{
			appError('No secret payload to encrypt.')
			return
		}

		try
		{
			const iv = window.crypto.getRandomValues(new Uint8Array(12))

			const ciphertextBuffer = await window.crypto.subtle.encrypt(
				{
					name: 'AES-GCM',
					iv,
				},
				derivedKey,
				secretPayload,
			)

			// Prepend the IV to the ciphertext for later use in decryption
			submittedPayload = new Uint8Array(iv.length + ciphertextBuffer.byteLength)
			submittedPayload.set(iv, 0)
			submittedPayload.set(new Uint8Array(ciphertextBuffer), iv.length)

			appLog('Message encrypted successfully.')
		}
		catch (error)
		{
			appError(`Error encrypting message: ${error instanceof Error ? error.message : String(error)}`)
		}
	}
}

function reset()
{
	inputText = ''
	if (secretFileElement)
	{
		secretFileElement.value = ''
	}
	selectedFileName = null
	resetPayload()
	appLog('Form reset.')
}

function resetPayload()
{
	secretPayload = null
	submittedPayload = null
	errorMessage = null
}

function downloadSubmittedPayload()
{
	if (!submittedPayload)
	{
		return
	}

	const blob = new Blob([submittedPayload], { type: 'application/octet-stream' })
	const url = URL.createObjectURL(blob)
	const a = document.createElement('a')
	a.href = url
	a.download = $processType === 'decryption'
		? 'secret-note.dec'
		: 'secret-note.enc'
	document.body.appendChild(a)
	a.click()
	document.body.removeChild(a)
	URL.revokeObjectURL(url)

	appLog('Encrypted payload downloaded.')
}

async function copySubmittedPayload()
{
	if (!submittedPayload || submittedPayload.length > submittedPayloadMaxCopySize)
	{
		return
	}

	setCopiedItem(null)

	let copyPayload: string

	if ($processType === 'encryption')
	{
		copyPayload = btoa(String.fromCharCode(...submittedPayload))
	}
	else if ($processType === 'decryption')
	{
		const decoder = new TextDecoder()
		copyPayload = decoder.decode(submittedPayload)
	}
	else
	{
		appError('Invalid process type.')
		return
	}

	try
	{
		await navigator.clipboard.writeText(copyPayload)
	}
	catch (error)
	{
		if ($processType === 'encryption')
		{
			appError(`Error copying encrypted payload: ${error instanceof Error ? error.message : String(error)}`)
		}
		else if ($processType === 'decryption')
		{
			appError(`Error copying decrypted payload: ${error instanceof Error ? error.message : String(error)}`)
		}
		else
		{
			appError(`Error copying submitted payload: ${error instanceof Error ? error.message : String(error)}`)
		}
		return
	}

	setCopiedItem('copySubmittedPayload')
}

function appLog(message: string)
{
	logMessage = message
	console.log(message)
}

function appError(message: string)
{
	errorMessage = message
	console.error(message)
}
</script>

<div class="card">
	<div class="card-body">

		<div class="flex flex-wrap justify-start items-center gap-4">
			<div class="flex flex-col justify-start items-start gap-0">
				<p>{_('Your key pair')}</p>
			</div>
			<div class="flex flex-wrap justify-start items-center gap-2">
				<div class="flex justify-start items-center gap-4">
					<p class="text-lg">
						<span class="icon icon-[mdi--arrow-right] icon-align"></span>
					</p>
					<div
						class="flex justify-start items-center gap-2 px-4 py-1 text-2xl rounded-full font-mono break-all border-2"
						style={[
							`background-color: ${publicKeyColor || '#000000'}20`,
							`border-color: ${publicKeyColor || '#000000'}80`,
						].join(';')}
					>
						<span>{keyPair ? '🔐' : '❓'}</span>
						{#if keyPair}
							<div class="flex flex-col justify-start items-start gap-0 text-xs text-gray-700">
								<span>{keyPair.privateKey.algorithm.name}</span>
								<span>{keyPair.privateKey.algorithm.namedCurve}</span>
							</div>
						{/if}
					</div>
				</div>
				<div class="flex justify-start items-center gap-2">
					<p class="text-lg">
						<span class="icon icon-[mdi--plus] icon-align"></span>
					</p>
					<p
						class="px-4 py-1 text-2xl rounded-full font-mono break-all border-2"
						style={[
							`background-color: ${publicKeyColor || '#000000'}20`,
							`border-color: ${publicKeyColor || '#000000'}80`,
						].join(';')}
					>
						{publicKeyEmojis || '❓❓❓'}
					</p>
				</div>
			</div>
			<div class="flex justify-start items-center gap-2">
				<button
					type="button"
					class="badge-button"
					aria-label={_('Regenerate your key pair')}
					on:click|preventDefault={generateKeyPair}
				>
					<span class="icon icon-[mdi--refresh] icon-align"></span>
				</button>
				<button
					type="button"
					class="badge-button"
					class:active={copiedItem === 'copyPublicKey'}
					aria-label={_('Copy your public key to clipboard')}
					on:click|preventDefault={copyPublicKeyToClipboard}
				>
					{#if copiedItem !== 'copyPublicKey'}
						<span class="icon icon-[mdi--content-copy] icon-align"></span>
					{:else}
						<span class="icon icon-[mdi--check] icon-align"></span>
					{/if}
				</button>
				<button
					type="button"
					class="badge-button"
					class:active={copiedItem === 'copyShareLink'}
					aria-label={_('Copy your share link to clipboard')}
					on:click|preventDefault={copyShareLinkToClipboard}
				>
					{#if copiedItem !== 'copyShareLink'}
						<span class="icon icon-[mdi--link-variant] icon-align"></span>
					{:else}
						<span class="icon icon-[mdi--check] icon-align"></span>
					{/if}
				</button>
				<button
					type="button"
					class="badge-button"
					class:active={copiedItem === 'copyShareText'}
					aria-label={_('Copy your share text to clipboard')}
					on:click|preventDefault={copyShareTextToClipboard}
				>
					{#if copiedItem !== 'copyShareText'}
						<span class="icon icon-[mdi--share] icon-align"></span>
					{:else}
						<span class="icon icon-[mdi--check] icon-align"></span>
					{/if}
				</button>
			</div>
		</div>

		<div class="flex flex-wrap flex-row-reverse justify-between items-stretch gap-4">
			<div class="grow flex flex-wrap flex-row-reverse justify-start items-center gap-4">
				<div class="flex flex-col justify-start items-start gap-0">
					{#if !peerPublicKeyHash || publicKeyHash !== peerPublicKeyHash}
						<p>{_('Peer public key')}</p>
					{:else}
						<p class="text-sm text-gray-700"><s>{_('Peer public key')}</s></p>
						<p>{_('Your public key')}</p>
					{/if}
				</div>
				<div class="flex justify-end items-center gap-4">
					<div class="flex justify-start items-center gap-2">
						<p
							class="px-4 py-1 text-2xl rounded-full font-mono break-all border-2"
							style={[
								`background-color: ${peerPublicKeyColor || '#000000'}20`,
								`border-color: ${peerPublicKeyColor || '#000000'}80`,
							].join(';')}
						>
							{peerPublicKeyEmojis || '❓❓❓'}
						</p>
					</div>
					<p class="text-lg">
						<span class="icon icon-[mdi--arrow-left] icon-align"></span>
					</p>
				</div>
				<div class="flex justify-start items-center gap-2">
					<button
						type="button"
						class="badge-button"
						class:active={copiedItem === 'pastePeerPublicKey'}
						aria-label={_('Paste peer public key')}
						on:click|preventDefault={pastePeerPublicKey}
					>
						{#if copiedItem !== 'pastePeerPublicKey'}
							<span class="icon icon-[mdi--content-paste] icon-align"></span>
						{:else}
							<span class="icon icon-[mdi--check] icon-align"></span>
						{/if}
					</button>
					<button
						type="button"
						class="badge-button"
						class:active={copiedItem === 'clearPeerPublicKey'}
						aria-label={_('Clear peer public key')}
						on:click|preventDefault={clearPeerPublicKey}
					>
						{#if copiedItem !== 'clearPeerPublicKey'}
							<span class="icon icon-[mdi--close] icon-align"></span>
						{:else}
							<span class="icon icon-[mdi--check] icon-align"></span>
						{/if}
					</button>
				</div>
			</div>
			<div class="grow flex flex-wrap justify-start items-center gap-4">
				<div class="flex flex-col justify-start items-start gap-0">
					<p>{_('Shared encryption key')}</p>
				</div>
				<div class="grow flex justify-start items-center gap-4">
					<p class="text-lg">
						<span class="icon icon-[mdi--arrow-right] icon-align"></span>
					</p>
					<div class="flex justify-center items-center gap-4">
						<p
							class="flex items-center gap-2 px-4 py-1 text-2xl rounded-full font-mono break-all border-2"
							style={[
								`background-color: ${derivedKey ? '#ffd700' : '#000000'}20`,
								`border-color: ${derivedKey ? '#ffd700' : '#000000'}80`,
							].join(';')}
						>
							<span>{derivedKey ? '🔑' : '❓'}</span>
						</p>
					</div>
				</div>
			</div>
		</div>

		<div class="flex flex-col justify-start items-start gap-2">
			<p class="text-sm text-gray-700">
				⌛🔒
				{@html _('For privacy, <b>your key pair is temporary</b>.')}
				{_('All keys will be reset if you leave or refresh this page (even if you change the language).')}
			</p>
			{#if publicKeyHash && publicKeyHash === peerPublicKeyHash}
				<p class="text-sm text-yellow-700">
					⚠️
					{@html _('You are encrypting messages <b>to yourself</b>!')}
					{_('Are you sure this is intended?')}
					{@html _('Because your key pair is temporary, <b>you won\'t be able to decrypt</b> your messages after you leave or refresh this page.')}
				</p>
			{/if}
		</div>

	</div>
</div>

<div class="card">
	{#if derivedKey}
		<div class="card-header">
			<div class="process-type-menu">
				<button
					type="button"
					class:active={$processType === 'encryption'}
					aria-label={_('Switch to encryption mode')}
					on:click|preventDefault={switchToEncryptionMode}
				>
					<span class="icon icon-[mdi--lock] icon-align text-2xl"></span>
					<span>{_('Encrypt')}</span>
				</button>
				<button
					type="button"
					class:active={$processType === 'decryption'}
					aria-label={_('Switch to decryption mode')}
					on:click|preventDefault={switchToDecryptionMode}
				>
					<span class="icon icon-[mdi--lock-open] icon-align text-2xl"></span>
					<span>{_('Decrypt')}</span>
				</button>
			</div>
		</div>

		<div class="card-body grid grid-cols-2 gap-4">

			<div class="col-span-2 flex flex-col gap-4">
				<div class="col-span-2 flex gap-4">
					<div class="input-type-menu">
						<button
							type="button"
							class:active={$inputType === 'textInput'}
							aria-label={_('Switch to text input')}
							on:click|preventDefault={switchToTextInput}
						>
							<span class="icon icon-[mdi--file-text-edit-outline] icon-align text-2xl"></span>
							<span>{_('Text')}</span>
						</button>
						<button
							type="button"
							class:active={$inputType === 'fileInput'}
							aria-label={_('Switch to file input')}
							on:click|preventDefault={switchToFileInput}
						>
							<span class="icon icon-[mdi--file-upload-outline] icon-align text-2xl"></span>
							<span>{_('File')}</span>
						</button>
					</div>
					<div class="grow flex flex-col gap-2 min-h-48">
						{#if $inputType === 'textInput'}
							<label class="flex flex-col gap-2 min-h-full">
								<div class="flex justify-start items-center gap-2">
									<div class="text-gray-700">
										{#if $processType === 'decryption'}
											{_('The encrypted payload')}
										{:else}
											{_('Your secret message')}
										{/if}
									</div>
									<button
										type="button"
										class="badge-button"
										class:active={copiedItem === 'pasteInputText'}
										aria-label={_('Paste secret message')}
										on:click|preventDefault={pasteInputText}
									>
										{#if copiedItem !== 'pasteInputText'}
											<span class="icon icon-[mdi--content-paste] icon-align"></span>
										{:else}
											<span class="icon icon-[mdi--check] icon-align"></span>
										{/if}
									</button>
								</div>
								<textarea
									class="grow form-textarea bg-gray-100 block p-2 rounded-md"
									bind:value={inputText}
								></textarea>
							</label>
						{:else if $inputType === 'fileInput'}
							<label class="flex flex-col gap-2 min-h-full">
								<div class="text-gray-700">
									{#if $processType === 'decryption'}
										{_('The encrypted file')}
									{:else}
										{_('Your secret file')}
									{/if}
								</div>
								<!-- Drag-and-Drop Area for File Input -->
								<label
									class="grow drop-zone hover:bg-gray-100 dragover:bg-gray-200 flex justify-center items-center text-sm text-gray-500 border-2 border-dashed rounded-md p-4 text-center cursor-pointer"
									on:dragover|preventDefault={() => dropZoneActive = true}
									on:dragleave={() => dropZoneActive = false}
									on:drop|preventDefault={(event) => handleFileDrop(event)}
								>
									<p class="text-gray-700">
										{#if selectedFileName}
											<span>{selectedFileName}</span>
										{:else}
											<span>{_('Drag and drop a file here, or click to select')}</span>
										{/if}
									</p>
									<input
										type="file"
										class="hidden"
										bind:this={secretFileElement}
										on:change={readSecretFile}
									/>
								</label>
							</label>
						{:else}
							<div class="flex justify-start items-center gap-2 min-h-full">
								<span class="text-gray-700">
									←
								</span>
								<p class="text-gray-700">
									{_('Select an input type to enter your secret message.')}
								</p>
							</div>
						{/if}
					</div>
				</div>
				<div class="flex justify-start items-center gap-4">
					<div class="flex justify-start items-center gap-2">
						<button
							type="button"
							class="btn btn-primary"
							disabled={!derivedKey || ($inputType === 'textInput' && !inputText) || ($inputType === 'fileInput' && !secretPayload)}
							on:click|preventDefault={submitPayload}
						>
							{#if $processType === 'decryption'}
								<span class="icon icon-[mdi--lock-open] icon-align"></span>
								{_('Decrypt payload')}
							{:else}
								<span class="icon icon-[mdi--lock] icon-align"></span>
								{_('Encrypt message')}
							{/if}
						</button>
						<button
							type="button"
							class="btn btn-secondary"
							on:click|preventDefault={reset}
						>
							{_('Reset')}
						</button>
					</div>
					{#if $inputType === 'textInput' || secretPayload}
						<div class="flex justify-start items-center gap-2">
							<p class="text-gray-700">
								<span class="icon icon-[mdi--content-save] icon-align"></span>
								{sizeToString($inputType === 'textInput'
									? new Blob([inputText]).size
									: (secretPayload ? secretPayload.length : 0)
								)}
							</p>
						</div>
					{/if}
				</div>
			</div>

			{#if submittedPayload}
				<div class="col-span-2 flex flex-col gap-4">
					{#if $processType === 'decryption' && submittedPayload.length <= submittedPayloadMaxDisplaySize}
						<div class="flex flex-col gap-2 min-h-48">
							<label class="grow flex flex-col gap-2 min-h-full">
								<div class="flex justify-start items-center gap-2">
									<div class="text-gray-700">
										{_('The decrypted message')}
									</div>
								</div>
								<textarea
									class="form-textarea bg-gray-100 block w-full h-full p-2 rounded-md flex-1"
									value={new TextDecoder().decode(submittedPayload)}
									readonly
								></textarea>
							</label>
						</div>
					{/if}
					<div class="flex justify-start items-center gap-4">
						<div class="flex justify-start items-center gap-2">
							<button
								type="button"
								class="btn btn-primary"
								on:click|preventDefault={downloadSubmittedPayload}
							>
								{#if $processType === 'decryption'}
									<span class="icon icon-[mdi--download] icon-align"></span>
									{#if $inputType === 'textInput'}
										{_('Download decrypted message')}
									{:else}
										{_('Download decrypted file')}
									{/if}
								{:else}
									<span class="icon icon-[mdi--download] icon-align"></span>
									{_('Download encrypted payload')}
								{/if}
							</button>
							{#if submittedPayload.length <= submittedPayloadMaxCopySize}
								<button
									type="button"
									class="btn btn-secondary"
									on:click|preventDefault={copySubmittedPayload}
								>
									{#if copiedItem !== 'copySubmittedPayload'}
										<span class="icon icon-[mdi--content-copy] icon-align"></span>
									{:else}
										<span class="icon icon-[mdi--check] icon-align"></span>
									{/if}
									{#if $processType === 'decryption'}
										{_('Copy decrypted message')}
									{:else}
										{_('Copy encrypted payload')}
									{/if}
								</button>
							{/if}
						</div>
						<div class="flex justify-start items-center gap-2">
							<p class="text-gray-700">
								<span class="icon icon-[mdi--content-save] icon-align"></span>
								{sizeToString(submittedPayload.length)}
							</p>
						</div>
					</div>
				</div>
			{/if}

			{#if errorMessage}
				<div class="col-span-2 flex flex-col gap-4">
					<div id="error" class="text-sm text-red-600">
						<span class="icon icon-[mdi--alert] icon-align"></span>
						{errorMessage}
					</div>
				</div>
			{/if}

		</div>
	{:else}
		<div class="card-body">
			<div class="flex flex-col justify-start items-center gap-2">
				<span class="icon icon-[mdi--lock-question] icon-align text-2xl"></span>
				<p class="text-gray-700">
					{_('The shared encryption key will be computed once the peer public key is set.')}
				</p>
			</div>
		</div>
	{/if}
</div>

<style lang="scss">
@reference "#tailwind.css";

.card {
	@apply bg-white w-full flex flex-col gap-0 shadow-lg rounded-lg overflow-hidden;

	.card-header {
	}

	.card-body {
		@apply flex flex-col justify-start items-stretch gap-4 p-6;
	}
}

.process-type-menu {
	@apply flex justify-center items-stretch gap-0;

	> button {
		@apply grow;
		@apply enabled:hover:bg-gray-300/30 enabled:active:bg-gray-300/40;
		@apply disabled:bg-gray-300/20;
		@apply flex justify-center items-center gap-2;
		@apply px-4 py-2 cursor-pointer disabled:cursor-not-allowed;
		@apply border-b-4 border-gray-400/40;

		&.active {
			@apply bg-blue-500/20 border-blue-500/80;
			@apply enabled:hover:bg-blue-500/30 enabled:active:bg-blue-500/40;
			@apply disabled:bg-blue-500/10;
		}
	}
}

.input-type-menu {
	@apply flex flex-col justify-center items-stretch gap-0;

	> button {
		@apply grow;
		@apply enabled:hover:bg-gray-300/30 enabled:active:bg-gray-300/40;
		@apply disabled:bg-gray-300/20;
		@apply flex flex-col justify-center items-center gap-1;
		@apply px-4 py-2 cursor-pointer disabled:cursor-not-allowed;
		@apply border-r-4 border-gray-300/80;

		&.active {
			@apply bg-blue-500/20 border-blue-500/80;
		}
	}
}

.btn {
	@apply
		bg-gray-400
		enabled:hover:bg-gray-500
		disabled:bg-gray-300
		px-4
		py-2
		text-white
		font-semibold
		rounded-md
		cursor-pointer
		disabled:cursor-not-allowed
		;

	&.enabled, &.active {
		@apply
			bg-gray-500
			hover:bg-gray-600
			;
	}

	&.btn-primary {
		@apply
			bg-blue-500
			enabled:hover:bg-blue-600
			disabled:bg-blue-300
			;

		&.enabled, &.active {
			@apply bg-blue-600 hover:bg-blue-700;
		}
	}

	&.btn-danger {
		@apply
			bg-red-600
			enabled:hover:bg-red-700
			disabled:bg-red-300
			;

		&.enabled, &.active {
			@apply bg-red-700 hover:bg-red-800;
		}
	}
}

.badge-button {
	@apply
		bg-gray-200
		enabled:hover:bg-gray-300
		disabled:bg-gray-100
		px-2 py-1
		text-gray-700
		font-medium
		rounded-full
		flex items-center gap-1
		disabled:cursor-not-allowed
		;

	&.enabled, &.active {
		@apply bg-green-200 text-green-700 hover:bg-green-300;
	}

	&.error {
		@apply bg-red-200 text-red-700 hover:bg-red-300;
	}
}

textarea {
	@apply
		border
		border-gray-300
		;

	&.default {
		@apply text-gray-600
	}

	&.error {
		@apply border-red-600 text-red-600;
	}
}

.drop-zone {
	@apply border-gray-300;
}

.drop-zone.dragover {
	@apply bg-gray-200;
}
</style>
