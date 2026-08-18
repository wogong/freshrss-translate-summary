<?php

declare(strict_types=1);

final class TranslateSummaryExtension extends Minz_Extension {
    private const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
    private const DEFAULT_MODEL = 'gpt-3.5-turbo';
    private const DEFAULT_REQUEST_TIMEOUT = 180;
    private const DEFAULT_CONNECT_TIMEOUT = 30;
    private const MAX_API_PROFILES = 20;
    private const DEFAULT_TRANSLATE_PROMPT = '请将以下内容翻译为中文，并尽可能保留原有 HTML 结构。';
    private const DEFAULT_SUMMARY_PROMPT = '请使用中文简明总结以下内容，提炼关键功能、新增内容、修复问题和重要变更。仅返回可直接插入网页的 HTML 片段，不要使用 Markdown，不要输出代码围栏、星号粗体、井号标题或 Markdown 列表标记；不要输出 html、head、body 标签。使用 p、h3、ul、li、strong、code 等 HTML 标签组织内容，只输出最终摘要，不要解释输出格式。';

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

        $notice = '翻译与摘要设置已保存。';
        $profileAction = Minz_Request::paramString('profile_action', true);
        $copyProfile = Minz_Request::paramString('copy_profile', true);
        $removeProfile = Minz_Request::paramString('remove_profile', true);

        if ($profileAction === 'add') {
            if (count($profiles) >= self::MAX_API_PROFILES) {
                $notice = '最多只能保存 20 个 API 配置。';
            } else {
                $previous = $profiles[count($profiles) - 1] ?? null;
                $profiles[] = [
                    'name' => '配置 ' . (count($profiles) + 1),
                    'base_url' => is_array($previous) ? $previous['base_url'] : self::DEFAULT_BASE_URL,
                    'api_key' => '',
                    'model' => is_array($previous) ? $previous['model'] : self::DEFAULT_MODEL,
                ];
                $notice = '已添加新的 API 配置，请填写后保存。';
            }
        } elseif (ctype_digit($copyProfile)) {
            $copyIndex = (int)$copyProfile;
            if (count($profiles) >= self::MAX_API_PROFILES) {
                $notice = '最多只能保存 20 个 API 配置。';
            } elseif (isset($profiles[$copyIndex])) {
                $copy = $profiles[$copyIndex];
                $copy['name'] = $copy['name'] . ' 副本';
                $profiles[] = $copy;
                $notice = '已复制 API 配置，可修改模型或其他参数后保存。';
            }
        } elseif (ctype_digit($removeProfile)) {
            $removeIndex = (int)$removeProfile;
            if (count($profiles) <= 1) {
                $notice = '至少需要保留一个 API 配置。';
            } elseif (isset($profiles[$removeIndex])) {
                array_splice($profiles, $removeIndex, 1);
                $notice = 'API 配置已删除。';
            }
        }

        $profiles = array_values(array_slice($profiles, 0, self::MAX_API_PROFILES));
        if ($profiles === []) {
            $profiles = [[
                'name' => '默认配置',
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
            'name' => '默认配置',
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
                'name' => $profile['name'] !== '' ? $profile['name'] : '配置 ' . ($index + 1),
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
                'name' => $name !== '' ? $name : '配置 ' . ($index + 1),
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
                'name' => $name !== '' ? $name : '配置 ' . ($index + 1),
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
