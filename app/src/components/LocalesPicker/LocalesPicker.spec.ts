import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import { expect, test } from 'vitest'
import LocalesPicker from './LocalesPicker.astro'

import { i18n as i18nConfig } from '~/config'

test('LocalesPicker with defaults', async () =>
{
	const container = await AstroContainer.create()
	const result = await container.renderToString(LocalesPicker)

	expect(result).toBeTruthy()
	expect(result).not.toContain('active')
})

test('LocalesPicker with EN language', async () =>
{
	const container = await AstroContainer.create()
	const result = await container.renderToString(LocalesPicker, {
		props: {
			lang: 'en',
		}
	})

	expect(result).toBeTruthy()
	expect(result).toContain('active')

	if (
		i18nConfig.routing.prefixDefaultLocale !== false
		|| (i18nConfig.defaultLocale as string) !== 'en'
	)
	{
		expect(result).toMatch(/<a href="\/en\/"[^>]+class="active"[^>]*>\s*<span class="icon icon-\[twemoji--flag-united-kingdom][^"]*"[^>]*><\/span>/)
	}
	else
	{
		expect(result).toMatch(/<a href="\/"[^>]+class="active"[^>]*>\s*<span class="icon icon-\[twemoji--flag-united-kingdom][^"]*"[^>]*><\/span>/)
	}
})

test('LocalesPicker with FR language', async () =>
{
	const container = await AstroContainer.create()
	const result = await container.renderToString(LocalesPicker, {
		props: {
			lang: 'fr',
		}
	})

	expect(result).toBeTruthy()
	expect(result).toContain('active')

	if (
		i18nConfig.routing.prefixDefaultLocale !== false
		|| (i18nConfig.defaultLocale as string) !== 'fr'
	)
	{
		expect(result).toMatch(/<a href="\/fr\/"[^>]+class="active"[^>]*>\s*<span class="icon icon-\[twemoji--flag-france][^"]*"[^>]*><\/span>/)
	}
	else
	{
		expect(result).toMatch(/<a href="\/"[^>]+class="active"[^>]*>\s*<span class="icon icon-\[twemoji--flag-france][^"]*"[^>]*><\/span>/)
	}
})
