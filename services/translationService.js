/**
 * TranslationService
 * ---------------------------------------------------------------------------
 * Traduz as respostas do modelo de inglês para português usando duas APIs
 * nativas do Chrome, que também rodam localmente no navegador:
 *  - Translator: faz a tradução en → pt
 *  - LanguageDetector: identifica o idioma do texto, para não traduzir à toa
 *
 * Por que é importante: o Gemini Nano responde melhor em inglês, mas a
 * aplicação é para usuários em português. Este serviço faz essa ponte.
 *
 * Ponto de atenção: se os modelos de tradução ainda não foram baixados, o
 * Chrome só permite criá-los durante um gesto do usuário (clique/submit).
 * Por isso a inicialização pode ser adiada até o primeiro envio do formulário.
 */
export class TranslationService {
    constructor() {
        this.translator = null;
        this.languageDetector = null;

        // Promise da inicialização em andamento/concluída (evita criar duas vezes)
        this.initPromise = null;

        // Fica true se o Chrome recusar o tradutor (NotSupportedError)
        this.unsupported = false;
    }

    // =========================================================================
    // 1. Inicialização
    // =========================================================================

    /**
     * Retorna true se os modelos já estão baixados e podem ser criados
     * sem gesto do usuário (ex.: logo ao carregar a página).
     */
    async isReady() {
        const [translatorAvailability, detectorAvailability] = await Promise.all([
            Translator.availability({ sourceLanguage: 'en', targetLanguage: 'pt' }),
            LanguageDetector.availability(),
        ]);
        return translatorAvailability === 'available' && detectorAvailability === 'available';
    }

    /**
     * Cria o Translator e o LanguageDetector. Pode ser chamado várias vezes:
     * todas as chamadas compartilham a mesma inicialização. Se falhar por algo
     * temporário, a próxima chamada tenta de novo.
     *
     * Se os modelos precisarem ser baixados ("downloadable"/"downloading"),
     * deve ser chamado de dentro de um gesto do usuário (ex.: clique/submit).
     */
    initialize() {
        if (this.unsupported) {
            return Promise.reject(new Error('⚠️ Tradução indisponível neste navegador.'));
        }

        this.initPromise ??= this.#create().catch((error) => {
            this.initPromise = null;
            console.error('Error initializing translation:', error);

            // NotSupportedError não se resolve tentando de novo — cada nova
            // tentativa só consome mais do limite de tradutores do Chrome
            if (error.name === 'NotSupportedError') {
                this.unsupported = true;
            }
            throw new Error('⚠️ Erro ao inicializar APIs de tradução.');
        });
        return this.initPromise;
    }

    async #create() {
        // Cria os dois em paralelo para que ambos usem a mesma ativação do usuário.
        // allSettled (em vez de all) para saber exatamente o que foi criado e
        // não deixar instâncias "órfãs" ocupando recursos quando uma delas falha.
        const [translatorResult, detectorResult] = await Promise.allSettled([
            Translator.create({
                sourceLanguage: 'en',
                targetLanguage: 'pt',
                // Mostra no console o progresso do download do modelo de tradução
                monitor(m) {
                    m.addEventListener('downloadprogress', (e) => {
                        const percent = ((e.loaded / e.total) * 100).toFixed(0);
                        console.log(`Translator downloaded ${percent}%`);
                    });
                }
            }),
            LanguageDetector.create(),
        ]);

        // Sem tradutor o serviço não funciona: libera o detector e propaga o erro
        if (translatorResult.status === 'rejected') {
            if (detectorResult.status === 'fulfilled') {
                detectorResult.value.destroy();
            }
            throw translatorResult.reason;
        }
        this.translator = translatorResult.value;

        // O detector é opcional: sem ele, apenas traduzimos sempre
        if (detectorResult.status === 'fulfilled') {
            this.languageDetector = detectorResult.value;
        } else {
            console.warn('Language Detector unavailable:', detectorResult.reason);
        }

        console.log('Translator initialized');
        return true;
    }

    // Libera os modelos de tradução (ex.: ao sair da página)
    destroy() {
        this.translator?.destroy();
        this.languageDetector?.destroy();
        this.translator = null;
        this.languageDetector = null;
        this.initPromise = null;
    }

    // =========================================================================
    // 2. Tradução
    // =========================================================================

    /**
     * Traduz o texto para português. Nunca lança erro: se a tradução não
     * estiver disponível ou falhar, devolve o texto original, para que o
     * usuário ao menos veja a resposta em inglês.
     */
    async translateToPortuguese(text) {
        if (!this.translator) {
            console.warn('Translator not available, returning original text');
            return text;
        }

        try {
            if (await this.#isPortuguese(text)) {
                console.log('Text is already in Portuguese');
                return text;
            }

            // Tradução em streaming
            const stream = this.translator.translateStreaming(text);
            let translated = '';
            for await (const chunk of stream) {
                translated = chunk; // Each chunk is the full translation so far
            }
            console.log('Translated text:', translated);
            return translated;
        } catch (error) {
            console.error('Translation error:', error);
            return text;
        }
    }

    // Usa o LanguageDetector para checar se o idioma mais provável é português
    async #isPortuguese(text) {
        if (!this.languageDetector) {
            return false;
        }

        const detectionResults = await this.languageDetector.detect(text);
        console.log('Detected languages:', detectionResults);
        return detectionResults?.[0]?.detectedLanguage === 'pt';
    }
}
