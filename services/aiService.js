/**
 * AIService
 * ---------------------------------------------------------------------------
 * Camada de acesso à Prompt API do Chrome (`LanguageModel`), que roda o modelo
 * Gemini Nano localmente no navegador — sem servidor e sem enviar dados para fora.
 *
 * Responsabilidades:
 *  1. Verificar se o navegador tem todas as APIs de IA necessárias (checkRequirements)
 *  2. Informar os parâmetros do modelo para a interface (getParams)
 *  3. Criar a sessão e gerar a resposta em streaming (createSession)
 *  4. Permitir cancelar uma geração em andamento (abort / isAborted)
 *
 * É o "coração" da aplicação: sem ele não há geração de respostas.
 */

// Maior lado aceito pelo modelo para imagens (acima disso o Chrome reduz a imagem)
const MAX_IMAGE_SIZE = 768;

// Valores padrão do Gemini Nano, usados quando LanguageModel.params() não está disponível
const DEFAULT_PARAMS = { defaultTopK: 3, maxTopK: 128, defaultTemperature: 1, maxTemperature: 2 };

export class AIService {
    constructor() {
        // Sessão ativa do modelo (recriada a cada pergunta)
        this.session = null;

        // Permite interromper a resposta em streaming (botão "parar")
        this.abortController = null;

        // Idiomas de entrada/saída declarados ao Chrome. Informar a saída é
        // obrigatório para o Chrome garantir qualidade e segurança da resposta.
        this.languageOptions = {
            expectedInputs: [{ type: "text", languages: ["en"] }],
            expectedOutputs: [{ type: "text", languages: ["en"] }],
        };
    }

    // =========================================================================
    // 1. Verificação de requisitos
    // =========================================================================

    /**
     * Confere navegador, APIs e disponibilidade do modelo.
     * Retorna `null` se tudo estiver pronto, ou uma lista de mensagens de erro
     * para a interface exibir ao usuário.
     */
    async checkRequirements() {
        const errors = await this.#checkBrowserApis();
        if (errors.length > 0) {
            return errors;
        }

        return this.#checkModelAvailability();
    }

    /**
     * Garante que é o Chrome e que as três APIs nativas estão ativas:
     * Prompt API (LanguageModel), Translator e LanguageDetector.
     */
    async #checkBrowserApis() {
        const errors = [];

        // @ts-ignore
        const isChrome = !!window.chrome;
        if (!isChrome) {
            errors.push("⚠️ Este recurso só funciona no Google Chrome ou Chrome Canary (versão recente).");
        }

        // Sem a Prompt API não há o que fazer — retorna imediatamente
        if (!('LanguageModel' in self)) {
            errors.push("⚠️ As APIs nativas de IA não estão ativas.");
            errors.push("Ative a seguinte flag em chrome://flags/:");
            errors.push("- Prompt API for Gemini Nano (chrome://flags/#prompt-api-for-gemini-nano)");
            errors.push("Depois reinicie o Chrome e tente novamente.");
            return errors;
        }

        // Translator: necessário para traduzir a resposta (en → pt)
        if ('Translator' in self) {
            const translatorAvailability = await Translator.availability({
                sourceLanguage: 'en',
                targetLanguage: 'pt'
            });
            console.log('Translator Availability:', translatorAvailability);

            if (translatorAvailability === 'unavailable') {
                errors.push("⚠️ Tradução de inglês para português não está disponível.");
            }
        } else {
            errors.push("⚠️ A API de Tradução não está ativa.");
            errors.push("Ative a seguinte flag em chrome://flags/:");
            errors.push("- Translation API (chrome://flags/#translation-api)");
        }

        // LanguageDetector: evita traduzir textos que já estão em português
        if (!('LanguageDetector' in self)) {
            errors.push("⚠️ A API de Detecção de Idioma não está ativa.");
            errors.push("Ative a seguinte flag em chrome://flags/:");
            errors.push("- Language Detection API (chrome://flags/#language-detector-api)");
        }

        return errors;
    }

    /**
     * Verifica se o modelo Gemini Nano já está no dispositivo.
     * Estados possíveis: 'available' | 'downloadable' | 'downloading' | 'unavailable'.
     */
    async #checkModelAvailability() {
        const errors = [];

        const availability = await LanguageModel.availability(this.languageOptions);
        console.log('Language Model Availability:', availability);

        if (availability === 'available') {
            return null;
        }

        if (availability === 'unavailable') {
            errors.push(`⚠️ O seu dispositivo não suporta modelos de linguagem nativos de IA.`);
        }

        if (availability === 'downloading') {
            errors.push(`⚠️ O modelo de linguagem de IA está sendo baixado. Por favor, aguarde alguns minutos e tente novamente.`);
        }

        if (availability === 'downloadable') {
            errors.push(`⚠️ O modelo de linguagem de IA precisa ser baixado, baixando agora... (acompanhe o progresso no terminal do chrome)`);
            const downloadError = await this.#downloadModel();
            if (!downloadError) {
                return null; // Download concluído com sucesso
            }
            errors.push(downloadError);
        }

        return errors.length > 0 ? errors : null;
    }

    /**
     * Dispara o download do modelo criando uma sessão temporária.
     * Retorna `null` em caso de sucesso ou a mensagem de erro.
     */
    async #downloadModel() {
        try {
            const session = await LanguageModel.create({
                ...this.languageOptions,
                monitor(m) {
                    m.addEventListener('downloadprogress', (e) => {
                        const percent = ((e.loaded / e.total) * 100).toFixed(0);
                        console.log(`Downloaded ${percent}%`);
                    });
                }
            });
            await session.prompt('Hello');
            session.destroy();

            // Confirma que o modelo ficou disponível após o download
            const newAvailability = await LanguageModel.availability(this.languageOptions);
            return newAvailability === 'available' ? null : '⚠️ O modelo ainda não está disponível.';
        } catch (error) {
            console.error('Error downloading model:', error);
            return `⚠️ Erro ao baixar o modelo: ${error.message}`;
        }
    }

    // =========================================================================
    // 2. Parâmetros do modelo
    // =========================================================================

    /**
     * Retorna os limites e valores padrão de temperature/topK, usados pela
     * interface para configurar os sliders.
     *  - temperature: controla a criatividade (maior = respostas mais variadas)
     *  - topK: quantas palavras candidatas o modelo considera a cada passo
     */
    async getParams() {
        // LanguageModel.params() foi removido para páginas web nas versões recentes do Chrome
        // (continua só para extensões). Sem ele, usamos os valores padrão do Gemini Nano.
        if (typeof LanguageModel.params !== 'function') {
            console.log('LanguageModel.params() unavailable, using defaults:', DEFAULT_PARAMS);
            return DEFAULT_PARAMS;
        }

        const params = await LanguageModel.params();
        console.log('Language Model Params:', params);
        return params;
    }

    // =========================================================================
    // 3. Geração de resposta
    // =========================================================================

    /**
     * Cria uma nova sessão com os parâmetros escolhidos e envia a pergunta
     * (opcionalmente com uma imagem ou áudio). É um async generator: cada
     * `yield` entrega um pedaço da resposta assim que o modelo o produz,
     * permitindo mostrar o texto na tela em tempo real.
     */
    async* createSession(question, temperature, topK, file = null) {
        // Cancela qualquer geração anterior ainda em andamento
        this.abortController?.abort();
        this.abortController = new AbortController();

        // Recria a sessão para aplicar os novos valores de temperature/topK
        if (this.session) {
            this.session.destroy();
        }

        this.session = await LanguageModel.create({
            // Entrada multimodal: texto, áudio e imagem
            expectedInputs: [
                { type: "text", languages: ["en"] },
                { type: "audio" },
                { type: "image" },
            ],
            expectedOutputs: [{ type: "text", languages: ["en"] }],
            temperature: temperature,
            topK: topK,
            // Prompt de sistema: define o comportamento do assistente
            initialPrompts: [
                {
                    role: 'system',
                    content: [{
                        type: "text",
                        value: `You are an AI assistant that responds clearly and objectively.
                        Always respond in plain text format instead of markdown.`
                    }]
                },
            ],
        });

        const contentArray = await this.#buildPromptContent(question, file);

        const responseStream = await this.session.promptStreaming(
            [
                {
                    role: 'user',
                    content: contentArray,
                },
            ],
            {
                signal: this.abortController.signal,
            }
        );

        for await (const chunk of responseStream) {
            if (this.abortController.signal.aborted) {
                break;
            }
            yield chunk;
        }
    }

    /**
     * Monta o conteúdo da mensagem do usuário: o texto da pergunta e, se houver,
     * o arquivo anexado (apenas imagem ou áudio são suportados pelo modelo).
     */
    async #buildPromptContent(question, file) {
        const contentArray = [{ type: "text", value: question }];

        if (file) {
            const fileType = file.type.split('/')[0];
            if (fileType === 'image') {
                contentArray.push({ type: 'image', value: await this.#resizeImage(file) });
                console.log('Adding image to prompt:', file.name);
            } else if (fileType === 'audio') {
                // Converte o arquivo em Blob, formato aceito pela Prompt API
                const blob = new Blob([await file.arrayBuffer()], { type: file.type });
                contentArray.push({ type: 'audio', value: blob });
                console.log('Adding audio to prompt:', file.name);
            }
        }

        return contentArray;
    }

    /**
     * O modelo só "enxerga" imagens de até 768x768: maiores são reduzidas pelo
     * Chrome de qualquer forma. Reduzimos antes, mantendo a proporção, para
     * gastar menos memória e evitar o aviso de downscale no console.
     */
    async #resizeImage(file) {
        const bitmap = await createImageBitmap(file);
        const scale = Math.min(1, MAX_IMAGE_SIZE / Math.max(bitmap.width, bitmap.height));
        if (scale === 1) {
            return bitmap;
        }

        const resized = await createImageBitmap(bitmap, {
            resizeWidth: Math.round(bitmap.width * scale),
            resizeHeight: Math.round(bitmap.height * scale),
            resizeQuality: 'high',
        });
        bitmap.close();
        return resized;
    }

    // =========================================================================
    // 4. Cancelamento
    // =========================================================================

    // Interrompe a resposta em andamento (usado pelo botão "parar")
    abort() {
        this.abortController?.abort();
    }

    // Indica se a geração atual foi cancelada pelo usuário
    isAborted() {
        return this.abortController?.signal.aborted;
    }
}
