export function hashToColor(hash: string): string
{
	// Use the first 6 characters of the hash to create a color
	return `#${hash.slice(0, 6)}`
}

// Emoji alphabet from Emoji-Codec (https://github.com/arpad1337/emoji-codec).
// (MIT License (c) 2025 Arpad K.)
const EMOJI_ALPHABET = [
	"🚀", "🌈", "🔥", "💎", "🍦", "🎈", "🍀", "🌟", "🐱", "🐶",
	"🍎", "🍌", "🍕", "🍔", "🍟", "🍣", "🍭", "🍩", "🍪", "🍺",
	"🍷", "🍹", "⚽", "🎮", "🎸", "🎬", "🚗", "🚲", "🏠", "🏢",
	"⌚", "📱", "💻", "💡", "🔑", "🔒", "⚡", "🌀", "🎭", "🎨",
	"🎤", "🎧", "🦄", "🐉", "🌵", "🌴", "🌙", "🌍", "🪐", "👻",
	"🤖", "👽", "👾", "👑", "👔", "💄", "🎩", "🎒", "👟", "🌻",
	"🌲", "🌊", "🌋", "🎁"
]

export function hashToEmojis(hash: string): string
{
	// Read the first 3 bytes of the hash and map them to emojis
	return Array.from({ length: 3 }, (_, i) => {
		const byte = parseInt(hash.slice(i * 2, i * 2 + 2), 16)
		return EMOJI_ALPHABET[byte % EMOJI_ALPHABET.length]
	}).join('')
}
