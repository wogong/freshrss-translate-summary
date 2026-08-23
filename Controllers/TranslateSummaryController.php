<?php

declare(strict_types=1);

final class FreshExtension_TranslateSummary_Controller extends FreshRSS_ActionController {
    public function translateAction(): void {
        $this->handleAction('translate');
    }

    public function summaryAction(): void {
        $this->handleAction('summary');
    }

    private function handleAction(string $action): void {
        $extension = $this->getExtension();
        if ($extension === null) {
            $this->sendJson(['ok' => false, 'error' => 'The Translate & Summary extension is unavailable; make sure it is enabled.'], 500);
            return;
        }

        $profileId = Minz_Request::paramString('profile_id', true);
        $profile = $extension->getApiProfile($profileId);
        if ($profile === null) {
            $this->sendJson(['ok' => false, 'error' => 'The selected API profile does not exist; refresh the page and try again.'], 400);
            return;
        }
        if ($profile['api_key'] === '') {
            $this->sendJson(['ok' => false, 'error' => 'The selected profile has no API key configured.'], 400);
            return;
        }

        $content = Minz_Request::paramString('content_html', true);
        if (trim($content) === '') {
            $this->sendJson(['ok' => false, 'error' => 'The article content is empty.'], 400);
            return;
        }

        $prompt = $action === 'summary'
            ? $extension->getSummaryPrompt()
            : $extension->getTranslatePrompt();

        $result = $this->requestCompletion(
            $profile['base_url'],
            $profile['api_key'],
            $profile['model'],
            $prompt,
            $content,
            $extension->getRequestTimeout(),
            $extension->getConnectTimeout()
        );

        if (!$result['ok']) {
            $this->sendJson(['ok' => false, 'error' => $result['error']], $result['status']);
            return;
        }

        $this->sendJson([
            'ok' => true,
            'translated_html' => $result['translated_html'],
            'profile_id' => $profileId !== '' ? $profileId : '0',
        ]);
    }

    private function getExtension(): ?TranslateSummaryExtension {
        foreach (Minz_ExtensionManager::listExtensions(true) as $extension) {
            if ($extension instanceof TranslateSummaryExtension) {
                return $extension;
            }
        }

        return null;
    }

    /**
     * @return array{ok:true,translated_html:string}|array{ok:false,error:string,status:int}
     */
    private function requestCompletion(
        string $baseUrl,
        string $apiKey,
        string $model,
        string $prompt,
        string $content,
        int $requestTimeout,
        int $connectTimeout
    ): array {
        $endpoint = rtrim($baseUrl, '/') . '/chat/completions';
        $bodyJson = json_encode([
            'model' => $model,
            'temperature' => 0.2,
            'messages' => [
                [
                    'role' => 'system',
                    'content' => $prompt,
                ],
                [
                    'role' => 'user',
                    'content' => $content,
                ],
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

        if (!is_string($bodyJson)) {
            return ['ok' => false, 'error' => 'Failed to build the API request body.', 'status' => 500];
        }

        $ch = curl_init($endpoint);
        if ($ch === false) {
            return ['ok' => false, 'error' => 'Failed to initialize the API request.', 'status' => 500];
        }

        curl_setopt_array($ch, [
            CURLOPT_POST => true,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_HTTPHEADER => [
                'Content-Type: application/json',
                'Authorization: Bearer ' . $apiKey,
            ],
            CURLOPT_POSTFIELDS => $bodyJson,
            CURLOPT_TIMEOUT => $requestTimeout,
            CURLOPT_CONNECTTIMEOUT => $connectTimeout,
        ]);

        $response = curl_exec($ch);
        $curlError = curl_error($ch);
        $statusCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($response === false) {
            return [
                'ok' => false,
                'error' => $curlError !== '' ? 'API request failed: ' . $curlError : 'API request failed.',
                'status' => 502,
            ];
        }

        $decoded = json_decode((string)$response, true);
        if (!is_array($decoded)) {
            return ['ok' => false, 'error' => 'The API returned an unparsable response.', 'status' => 502];
        }

        if (
            isset($decoded['error']) &&
            is_array($decoded['error']) &&
            is_string($decoded['error']['message'] ?? null)
        ) {
            return [
                'ok' => false,
                'error' => $decoded['error']['message'],
                'status' => $statusCode > 0 ? $statusCode : 502,
            ];
        }

        $translated = $decoded['choices'][0]['message']['content'] ?? '';
        if (!is_string($translated) || trim($translated) === '') {
            return ['ok' => false, 'error' => 'The API returned an empty translation or summary.', 'status' => 502];
        }

        return ['ok' => true, 'translated_html' => $translated];
    }

    /** @param array<string,mixed> $payload */
    private function sendJson(array $payload, int $status = 200): void {
        if (ob_get_level() > 0) {
            ob_clean();
        }

        $this->view->_layout(null);
        http_response_code($status);
        header('Content-Type: application/json; charset=UTF-8');

        $json = json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        echo is_string($json) ? $json : '{"ok":false,"error":"Failed to encode the response."}';
        exit;
    }
}
