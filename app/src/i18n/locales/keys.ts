import type { DefaultLocale } from '~/i18n/types.d.ts'

export const localeKeys = [
	'Welcome!',
	'Secret Note',
	'Online encryption tool for sharing secret notes.',
] as const satisfies DefaultLocale

export type DefaultLocaleConst = typeof localeKeys
