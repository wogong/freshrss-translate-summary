<?php

declare(strict_types=1);

final class TranslateSummaryExtension extends Minz_Extension {
    private const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
    private const DEFAULT_MODEL = 'gpt-3.5-turbo';
    private const DEFAULT_REQUEST_TIMEOUT = 180;
    private const DEFAULT_CONNECT_TIMEOUT = 30;
    private const MAX_API_PROFILES = 20;
    private const DEFAULT_TRANSLATE_PROMPT = <<<'PROMPT'
You are a professional Chinese native translator who needs to fluently translate text into Chinese.

## Translation Rules
1. Output only the translated content, without explanations or additional content (such as "Here's the translation:" or "Translation as follows:")
2. The returned translation must maintain exactly the same number of paragraphs and format as the original text
3. If the text contains HTML tags, consider where the tags should be placed in the translation while maintaining fluency
4. For content that should not be translated (such as proper nouns, code, etc.), keep the original text.
5. If input contains %%, use %% in your output, if input has no %%, don't use %% in your output

## OUTPUT FORMAT:
- **Single paragraph input** → Output translation directly (no separators, no extra text)
- **Multi-paragraph input** → Use %% as paragraph separator between translations

## Examples
### Multi-paragraph Input:
Paragraph A

%%

Paragraph B

%%

Paragraph C

%%

Paragraph D

### Multi-paragraph Output:
Translation A

%%

Translation B

%%

Translation C

%%

Translation D

### Single paragraph Input:
Single paragraph content

### Single paragraph Output:
Direct translation without separators
PROMPT;
    private const DEFAULT_SUMMARY_PROMPT = 'Summarize the following text in Chinese with key points, keeping it concise.';

    public function init(): void {
        $this->registerHook('entry_before_display', [$this, 'injectTranslateUi']);
        $this->registerHook('js_vars', [$this, 'injectJsVars']);
        $this->registerController('TranslateSummary');

        Minz_View::appendScript($this->getFileUrl('translate.js'));
        Minz_View::appendStyle($this->getFileUrl('translate.css'));
    }

    public function handleConfigureAction(): void {
        if (!Minz_Request::isPost()) {
            return;
        }

        $requestTimeout = $this->normalizeTimeout(
            trim(Minz_Request::paramString('request_timeout', true)),
            self::DEFAULT_REQUEST_TIMEOUT,
            10,
            600
        );
        $connectTimeout = $this->normalizeTimeout(
            trim(Minz_Request::paramString('connect_timeout', true)),
            self::DEFAULT_CONNECT_TIMEOUT,
            1,
            120
        );

        $stored = $this->getApiProfiles();
        $profiles = $this->readPostedApiProfiles($stored);
        if ($profiles === []) {
            $profiles = $stored;
        }

        $notice = 'Translate & Summary settings saved.';
        $profileAction = Minz_Request::paramString('profile_action', true);
        $copyProfile = Minz_Request::paramString('copy_profile', true);
        $removeProfile = Minz_Request::paramString('remove_profile', true);

        if ($profileAction === 'add') {
            if (count($profiles) >= self::MAX_API_PROFILES) {
                $notice = 'At most 20 API profiles can be saved.';
            } else {
                $previous = $profiles[count($profiles) - 1] ?? null;
                $profiles[] = [
                    'name' => 'Profile ' . (count($profiles) + 1),
                    'base_url' => is_array($previous) ? $previous['base_url'] : self::DEFAULT_BASE_URL,
                    'api_key' => '',
                    'model' => is_array($previous) ? $previous['model'] : self::DEFAULT_MODEL,
                ];
                $notice = 'New API profile added; fill it in and save.';
            }
        } elseif (ctype_digit($copyProfile)) {
            $copyIndex = (int)$copyProfile;
            if (count($profiles) >= self::MAX_API_PROFILES) {
                $notice = 'At most 20 API profiles can be saved.';
            } elseif (isset($profiles[$copyIndex])) {
                $copy = $profiles[$copyIndex];
                $copy['name'] = $copy['name'] . ' (copy)';
                $profiles[] = $copy;
                $notice = 'API profile copied; adjust the model or other settings and save.';
            }
        } elseif (ctype_digit($removeProfile)) {
            $removeIndex = (int)$removeProfile;
            if (count($profiles) <= 1) {
                $notice = 'At least one API profile must remain.';
            } elseif (isset($profiles[$removeIndex])) {
                array_splice($profiles, $removeIndex, 1);
                $notice = 'API profile removed.';
            }
        }

        $profiles = array_values(array_slice($profiles, 0, self::MAX_API_PROFILES));
        if ($profiles === []) {
            $profiles = [[
                'name' => 'Default profile',
                'base_url' => self::DEFAULT_BASE_URL,
                'api_key' => '',
                'model' => self::DEFAULT_MODEL,
            ]];
        }

        $profilesJson = json_encode($profiles, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        if (!is_string($profilesJson)) {
            $profilesJson = '[]';
        }

        $config = [
            'api_profiles' => $profilesJson,
            'request_timeout' => (string)$requestTimeout,
            'connect_timeout' => (string)$connectTimeout,
            'translate_prompt' => trim(Minz_Request::paramString('translate_prompt', true)),
            'summary_prompt' => trim(Minz_Request::paramString('summary_prompt', true)),
        ];

        $this->setConfigValues($config);
        Minz_Request::good($notice, [
            'c' => 'extension',
            'a' => 'configure',
            'params' => ['e' => $this->getName()],
        ]);
    }

    public function injectTranslateUi(FreshRSS_Entry $entry): FreshRSS_Entry {
        return $entry;
    }

    /**
     * @param array<string,mixed> $vars
     * @return array<string,mixed>
     */
    public function injectJsVars(array $vars): array {
        $vars['translateCn'] = [
            'translateEndpoint' => '?c=TranslateSummary&a=translate',
            'summaryEndpoint' => '?c=TranslateSummary&a=summary',
            'csrf' => FreshRSS_Auth::csrfToken(),
            'profiles' => $this->getPublicApiProfiles(),
        ];

        return $vars;
    }

    /**
     * @return list<array{name:string,base_url:string,api_key:string,model:string}>
     */
    public function getApiProfiles(): array {
        $profiles = $this->decodeApiProfiles($this->getConfigValue('api_profiles'));
        if ($profiles !== []) {
            return $profiles;
        }

        return [[
            'name' => 'Default profile',
            'base_url' => $this->getConfigValue('api_base_url', self::DEFAULT_BASE_URL),
            'api_key' => $this->getConfigValue('api_key'),
            'model' => $this->getConfigValue('model', self::DEFAULT_MODEL),
        ]];
    }

    /**
     * @return list<array{id:string,name:string,model:string}>
     */
    public function getPublicApiProfiles(): array {
        $publicProfiles = [];
        foreach ($this->getApiProfiles() as $index => $profile) {
            $publicProfiles[] = [
                'id' => (string)$index,
                'name' => $profile['name'] !== '' ? $profile['name'] : 'Profile ' . ($index + 1),
                'model' => $profile['model'],
            ];
        }

        return $publicProfiles;
    }

    /**
     * @return array{name:string,base_url:string,api_key:string,model:string}|null
     */
    public function getApiProfile(string $profileId): ?array {
        if ($profileId === '') {
            $profileId = '0';
        }
        if (!ctype_digit($profileId)) {
            return null;
        }

        $profiles = $this->getApiProfiles();
        $index = (int)$profileId;
        return $profiles[$index] ?? null;
    }

    public function getRequestTimeout(): int {
        return $this->normalizeTimeout(
            $this->getConfigValue('request_timeout', (string)self::DEFAULT_REQUEST_TIMEOUT),
            self::DEFAULT_REQUEST_TIMEOUT,
            10,
            600
        );
    }

    public function getConnectTimeout(): int {
        return $this->normalizeTimeout(
            $this->getConfigValue('connect_timeout', (string)self::DEFAULT_CONNECT_TIMEOUT),
            self::DEFAULT_CONNECT_TIMEOUT,
            1,
            120
        );
    }

    public function getTranslatePrompt(): string {
        return $this->getConfigValue('translate_prompt', self::DEFAULT_TRANSLATE_PROMPT);
    }

    public function getSummaryPrompt(): string {
        return $this->getConfigValue('summary_prompt', self::DEFAULT_SUMMARY_PROMPT);
    }

    public function getConfigValue(string $key, string $default = ''): string {
        $value = $this->getUserConfigurationValue($key, $default);
        if (is_string($value) || is_int($value) || is_bool($value)) {
            $valueString = (string)$value;
            return $valueString !== '' ? $valueString : $default;
        }

        return $default;
    }

    /** @param array<string,mixed> $values */
    public function setConfigValues(array $values): void {
        $current = $this->getUserConfiguration();
        foreach ($values as $key => $value) {
            if (is_string($value) || is_int($value) || is_bool($value)) {
                $current[$key] = (string)$value;
            }
        }

        $this->setUserConfiguration($current);
    }

    /**
     * A blank posted API key keeps the stored key at the same position (keys are not echoed into the form).
     * @param list<array{name:string,base_url:string,api_key:string,model:string}> $stored
     * @return list<array{name:string,base_url:string,api_key:string,model:string}>
     */
    private function readPostedApiProfiles(array $stored): array {
        $names = Minz_Request::paramArrayString('profile_name', true);
        $baseUrls = Minz_Request::paramArrayString('profile_base_url', true);
        $apiKeys = Minz_Request::paramArrayString('profile_api_key', true);
        $models = Minz_Request::paramArrayString('profile_model', true);
        $count = min(self::MAX_API_PROFILES, max(count($names), count($baseUrls), count($apiKeys), count($models)));

        if ($count <= 0) {
            return [];
        }

        $profiles = [];
        for ($index = 0; $index < $count; $index++) {
            $item = [
                'name' => $names[$index] ?? '',
                'base_url' => $baseUrls[$index] ?? '',
                'api_key' => $apiKeys[$index] ?? '',
                'model' => $models[$index] ?? '',
            ];

            $name = $this->profileString($item, 'name', 100);
            $baseUrl = $this->profileString($item, 'base_url', 2048);
            $apiKey = $this->profileString($item, 'api_key', 4096);
            $model = $this->profileString($item, 'model', 255);

            $profiles[] = [
                'name' => $name !== '' ? $name : 'Profile ' . ($index + 1),
                'base_url' => $baseUrl !== '' ? rtrim($baseUrl, '/') : self::DEFAULT_BASE_URL,
                'api_key' => $apiKey !== '' ? $apiKey : ($stored[$index]['api_key'] ?? ''),
                'model' => $model !== '' ? $model : self::DEFAULT_MODEL,
            ];
        }

        return $profiles;
    }

    /**
     * @return list<array{name:string,base_url:string,api_key:string,model:string}>
     */
    private function decodeApiProfiles(string $profilesJson): array {
        if ($profilesJson === '') {
            return [];
        }

        $decoded = json_decode($profilesJson, true);
        if (!is_array($decoded)) {
            return [];
        }

        $profiles = [];
        foreach (array_slice($decoded, 0, self::MAX_API_PROFILES) as $index => $item) {
            if (!is_array($item)) {
                continue;
            }

            $baseUrl = $this->profileString($item, 'base_url', 2048);
            $apiKey = $this->profileString($item, 'api_key', 4096);
            $model = $this->profileString($item, 'model', 255);
            $name = $this->profileString($item, 'name', 100);

            if ($baseUrl === '' && $apiKey === '' && $model === '' && $name === '') {
                continue;
            }

            $profiles[] = [
                'name' => $name !== '' ? $name : 'Profile ' . ($index + 1),
                'base_url' => $baseUrl !== '' ? rtrim($baseUrl, '/') : self::DEFAULT_BASE_URL,
                'api_key' => $apiKey,
                'model' => $model !== '' ? $model : self::DEFAULT_MODEL,
            ];
        }

        return $profiles;
    }

    /** @param array<mixed> $profile */
    private function profileString(array $profile, string $key, int $maxLength): string {
        $value = $profile[$key] ?? '';
        if (!is_string($value) && !is_int($value) && !is_bool($value)) {
            return '';
        }

        $value = trim((string)$value);
        if (function_exists('mb_substr')) {
            return mb_substr($value, 0, $maxLength, 'UTF-8');
        }

        return substr($value, 0, $maxLength);
    }

    private function normalizeTimeout(string $value, int $default, int $min, int $max): int {
        if ($value === '' || !ctype_digit($value)) {
            return $default;
        }

        return max($min, min($max, (int)$value));
    }
}
