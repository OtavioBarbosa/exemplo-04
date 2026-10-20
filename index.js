import { AIService } from './services/aiService.js';
import { TranslationService } from './services/translationService.js';
import { View } from './views/view.js';
import { FormController } from './controllers/formController.js';

(async function main() {
    // Initialize services and view
    const aiService = new AIService();
    const translationService = new TranslationService();
    const view = new View();

    // Libera os modelos de tradução ao sair/recarregar a página
    window.addEventListener('pagehide', () => translationService.destroy());
    
    // Set current year
    view.setYear();

    // Check requirements
    const errors = await aiService.checkRequirements();
    if (errors) {
        view.showError(errors);
        return;
    }

    // Initialize translation services now if models are already downloaded;
    // otherwise they are created on the first submit (requires a user gesture)
    try {
        if (await translationService.isReady()) {
            await translationService.initialize();
        } else {
            console.log('Translation models will be downloaded on first submit');
        }
    } catch (error) {
        console.error('Error initializing translation:', error);
        view.showError([error.message]);
        return;
    }

    // Get and initialize AI parameters
    const params = await aiService.getParams();
    view.initializeParameters(params);

    // Initialize controller and setup event listeners
    const controller = new FormController(aiService, translationService, view);
    controller.setupEventListeners();

    console.log('Application initialized successfully');
})();
