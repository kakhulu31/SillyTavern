import { chat_metadata } from "../../../script.js";
import { getContext, extension_settings, saveMetadataDebounced } from "../../extensions.js";
import {
    substituteParams,
    eventSource,
    event_types,
} from "../../../script.js";

const MODULE_NAME = "Objective"


let globalObjective = ""
let globalTasks = []
let currentChatId = ""
let currentTask = {}
let checkCounter = 0


const objectivePrompts = {
    "createTask": `Pause your roleplay and generate a list of tasks to complete an objective. Your next response must be formatted as a numbered list of plain text entries. Do not include anything but the numbered list. The list must be prioritized in the order that tasks must be completed.

    The objective that you must make a numbered task list for is: [{{objective}}].
    The tasks created should take into account the character traits of {{char}}. These tasks may or may not involve {{user}} directly. Be sure to include the objective as the final task.

    Given an example objective of 'Make me a four course dinner', here is an example output:
    1. Determine what the courses will be
    2. Find recipes for each course
    3. Go shopping for supplies with {{user}}
    4. Cook the food
    5. Get {{user}} to set the table
    6. Serve the food
    7. Enjoy eating the meal with {{user}}
    `,
    "checkTaskCompleted": `Pause your roleplay. Determine if this task is completed: [{{task}}].
    To do this, examine the most recent messages. Your response must only contain either true or false, nothing other words.
    Example output:
    true
    `
}

const injectPrompts = {
    "task": "Your current task is [{{task}}]. Balance existing roleplay with completing this task."
}

// Background prompt generation
async function generateQuietPrompt(quiet_prompt) {
    return await new Promise(
        async function promptPromise(resolve, reject) {
            try {
                await getContext().generate('quiet', { resolve, reject, quiet_prompt, force_name2: true, });
            }
            catch {
                reject();
            }
        });
}

//###############################//
//#       Task Management       #//
//###############################//

// Accepts optional position. Defaults to adding to end of list.
function addTask(description, position = null) {
    position = position != null ? position : position = globalTasks.length
    globalTasks.splice(position, 0, {
        "description": description,
        "completed": false
    })
    saveState()
}

// Get a task either by index or task description. Return current task if none specified
function getTask(index = null, taskDescription = null) {
    let task = {}
    if (index == null && taskDescription == null) {
        task = currentTask
    } else if (index != null) {
        task = globalObjective[index]
    } else if (taskDescription != null) {
        task = globalTasks.find(task => {
            return task.description == description ? true : false
        })
    }
    return task
}

function deleteTask(index) {
    globalTasks.splice(index, 1)
    setCurrentTask()
    updateUiTaskList()
}

// Complete the current task, setting next task to next incomplete task
function completeTask(task) {
    task.completed = true
    console.info(`Task successfully completed: ${JSON.stringify(task)}`)
    setCurrentTask()
    updateUiTaskList()
}

// Call Quiet Generate to create task list using character context, then convert to tasks. Should not be called much.
async function generateTasks() {
    const prompt = substituteParams(objectivePrompts["createTask"].replace(/{{objective}}/gi, globalObjective));
    console.log(`Generating tasks for objective with prompt`)
    toastr.info('Generating tasks for objective', 'Please wait...');
    const taskResponse = await generateQuietPrompt(prompt)
    globalTasks = []
    const numberedListPattern = /^\d+\./

    // Add numbered tasks, store them without the numbers.
    for (const task of taskResponse.split('\n').map(x => x.trim())) {
        if (task.match(numberedListPattern) != null) {
            addTask(task.replace(numberedListPattern, '').trim())
        }
    }
    updateUiTaskList()
    console.info(`Response for Objective: '${globalObjective}' was \n'${taskResponse}', \nwhich created tasks \n${JSON.stringify(globalTasks, null, 2)} `)
    toastr.success(`Generated ${globalTasks.length} tasks`, 'Done!');
}

// Call Quiet Generate to check if a task is completed
async function checkTaskCompleted() {
    // Make sure there are tasks 
    if (Object.keys(currentTask).length == 0) {
        return
    }
    checkCounter = $('#objective-check-frequency').val()

    const prompt = substituteParams(objectivePrompts["checkTaskCompleted"].replace(/{{task}}/gi, currentTask.description));
    const taskResponse = (await generateQuietPrompt(prompt)).toLowerCase()

    // Check response if task complete
    if (taskResponse.includes("true")) {
        console.info(`Character determined task '${JSON.stringify(currentTask)} is completed.`)
        completeTask(getTask())
    } else if (!(taskResponse.includes("false"))) {
        console.warn(`checkTaskCompleted response did not contain true or false. taskResponse: ${taskResponse}`)
    } else {
        console.debug(`Checked task completion. taskResponse: ${taskResponse}`)
    }
}


// Set a task in extensionPrompt context. Defaults to first incomplete
function setCurrentTask(index = null) {
    const context = getContext();
    currentTask = {};

    if (index === null) {
        currentTask = globalTasks.find(task => !task.completed) || {};
    } else if (index >= 0 && index < globalTasks.length) {
        currentTask = globalTasks[index];
    }

    const { description } = currentTask;
    const injectPromptsTask = injectPrompts["task"].replace(/{{task}}/gi, description);

    if (description) {
        context.setExtensionPrompt(MODULE_NAME, injectPromptsTask, 1, $('#objective-chat-depth').val());
        console.info(`Current task in context.extensionPrompts.Objective is ${JSON.stringify(context.extensionPrompts.Objective)}`);
    } else {
        context.setExtensionPrompt(MODULE_NAME, '');
        console.info(`No current task`);
    }

    saveState();
}



//###############################//
//#       UI AND Settings       #//
//###############################//


const defaultSettings = {
    objective: "",
    tasks: [],
    chatDepth: 2,
    checkFrequency: 3,
    hideTasks: false
}

// Convenient single call. Not much at the moment.
function resetState() {
    loadSettings();
}

//
function saveState() {
    const context = getContext();

    if (currentChatId == "") {
        currentChatId = context.chatId
    }

    chat_metadata['objective'] = {
        objective: globalObjective,
        tasks: globalTasks,
        checkFrequency: $('#objective-check-frequency').val(),
        chatDepth: $('#objective-chat-depth').val(),
        hideTasks: $('#objective-hide-tasks').prop('checked'),
    }

    saveMetadataDebounced();
}

// Dump core state
function debugObjectiveExtension() {
    console.log(JSON.stringify({
        "currentTask": currentTask,
        "currentChatId": currentChatId,
        "checkCounter": checkCounter,
        "globalObjective": globalObjective,
        "globalTasks": globalTasks,
        "extension_settings": chat_metadata['objective'],
    }, null, 2))
}

window.debugObjectiveExtension = debugObjectiveExtension


// Add a single task to the UI and attach event listeners for user edits
function addUiTask(taskIndex, taskComplete, taskDescription) {
    const template = `
      <div id="objective-task-label-${taskIndex}" class="flex1 checkbox_label">
          <span>${taskIndex}</span>
          <input id="objective-task-complete-${taskIndex}" type="checkbox">
          <span class="text_pole" style="display: block" id="objective-task-description-${taskIndex}" contenteditable>${taskDescription}</span>
          <div id="objective-task-delete-${taskIndex}" class="objective-task-button fa-solid fa-xmark fa-2x" title="Delete Task"></div>
          <div id="objective-task-add-${taskIndex}" class="objective-task-button fa-solid fa-plus fa-2x" title="Add Task"></div>
      </div>
    `;

    // Add the filled out template
    $('#objective-tasks').append(template);

    // Add event listeners and set properties
    $(`#objective-task-complete-${taskIndex}`).prop('checked', taskComplete);
    $(`#objective-task-complete-${taskIndex}`).on('click', event => {
        const index = Number(event.target.id.split('-').pop());
        globalTasks[index].completed = event.target.checked;
        setCurrentTask();
    });
    $(`#objective-task-description-${taskIndex}`).on('keyup', event => {
        const index = Number(event.target.id.split('-').pop());
        globalTasks[index].description = event.target.textContent;
    });
    $(`#objective-task-delete-${taskIndex}`).on('click', event => {
        const index = Number(event.target.id.split('-').pop());
        deleteTask(index)
    });
    $(`#objective-task-add-${taskIndex}`).on('click', event => {
        const index = Number(event.target.id.split('-').pop()) + 1;
        addTask("", index)
        setCurrentTask()
        updateUiTaskList()
    });
}

// Populate UI task list
function updateUiTaskList() {
    $('#objective-tasks').empty()
    // Show tasks if there are any
    if (globalTasks.length > 0) {
        for (const index in globalTasks) {
            addUiTask(
                index,
                globalTasks[index].completed,
                globalTasks[index].description
            )
        }
    } else {
        // Show button to add tasks if there are none
        $('#objective-tasks').append(`
        <input id="objective-task-add-first" type="button" class="menu_button" value="Add Task">
        `)
        $("#objective-task-add-first").on('click', () => {
            addTask("")
            setCurrentTask()
            updateUiTaskList()
        })
    }
}

function addManualTaskCheck() {
    $('#extensionsMenu').prepend(`
        <div id="objective-task-manual-check-menu-item" class="list-group-item flex-container flexGap5">
            <div id="objective-task-manual-check" class="extensionsMenuExtensionButton fa-regular fa-square-check"/></div>
            Manual Task Check
        </div>`)
    $('#objective-task-manual-check-menu-item').attr('title', 'Trigger AI check of completed tasks').on('click', checkTaskCompleted)
}

// Trigger creation of new tasks with given objective.
async function onGenerateObjectiveClick() {
    globalObjective = $('#objective-text').val()
    await generateTasks()
    saveState()
}

// Update extension prompts
function onChatDepthInput() {
    saveState()
    setCurrentTask() // Ensure extension prompt is updated
}

// Update how often we check for task completion
function onCheckFrequencyInput() {
    checkCounter = $("#objective-check-frequency").val()
    $('#objective-counter').text(checkCounter)
    saveState()
}

function onHideTasksInput() {
    $('#objective-tasks').prop('hidden', $('#objective-hide-tasks').prop('checked'))
    saveState()
}

function loadSettings() {
    // Load/Init settings for chatId
    currentChatId = getContext().chatId

    // Bail on home screen
    if (currentChatId == undefined) {
        return
    }

    // Migrate existing settings
    if (currentChatId in extension_settings.objective) {
        chat_metadata['objective'] = extension_settings.objective[currentChatId];
        delete extension_settings.objective[currentChatId];
    }

    if (!('objective' in chat_metadata)) {
        Object.assign(chat_metadata, { objective: defaultSettings });
    }

    // Update globals
    globalObjective = chat_metadata['objective'].objective
    globalTasks = chat_metadata['objective'].tasks
    checkCounter = chat_metadata['objective'].checkFrequency

    // Update UI elements
    $('#objective-counter').text(checkCounter)
    $("#objective-text").text(globalObjective)
    updateUiTaskList()
    $('#objective-chat-depth').val(chat_metadata['objective'].chatDepth)
    $('#objective-check-frequency').val(chat_metadata['objective'].checkFrequency)
    $('#objective-hide-tasks').prop('checked', chat_metadata['objective'].hideTasks)
    onHideTasksInput()
    setCurrentTask()
}

jQuery(() => {
    const settingsHtml = `
    <div class="objective-settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
            <b>Objective</b>
            <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
        </div>
        <div class="inline-drawer-content">
            <label for="objective-text"><small>Enter an objective and generate tasks. The AI will attempt to complete tasks autonomously</small></label>
            <textarea id="objective-text" type="text" class="text_pole textarea_compact" rows="4"></textarea>
            <div class="objective_block flex-container">
                <input id="objective-generate" class="menu_button" type="submit" value="Auto-Generate Tasks" />                
                <label class="checkbox_label"><input id="objective-hide-tasks" type="checkbox"> Hide Tasks</label>
            </div>
            
            <div id="objective-tasks"> </div>
            <div class="objective_block margin-bot-10px">
                <div class="objective_block objective_block_control flex1 flexFlowColumn">
                    <label for="objective-chat-depth">Position in Chat</label>
                    <input id="objective-chat-depth" class="text_pole widthUnset" type="number" min="0" max="99" />
                    <small>Depth</small>
                </div>
                <div class="objective_block objective_block_control flex1 flexFlowColumn">
                    <label for="objective-check-frequency">Task Check Frequency</label>
                    <input id="objective-check-frequency" class="text_pole widthUnset" type="number" min="0" max="99" />
                    <small>(0 = disabled)</small>
                </div>
            </div>
            <span> Messages until next AI task completion check <span id="objective-counter">0</span></span>
            <hr class="sysHR">
        </div>
    </div>`;

    addManualTaskCheck()
    $('#extensions_settings').append(settingsHtml);
    $('#objective-generate').on('click', onGenerateObjectiveClick)
    $('#objective-chat-depth').on('input', onChatDepthInput)
    $("#objective-check-frequency").on('input', onCheckFrequencyInput)
    $('#objective-hide-tasks').on('click', onHideTasksInput)
    loadSettings()

    eventSource.on(event_types.CHAT_CHANGED, () => {
        resetState()
    });

    eventSource.on(event_types.MESSAGE_RECEIVED, () => {
        if (currentChatId == undefined) {
            return
        }
        if ($("#objective-check-frequency").val() > 0) {
            // Check only at specified interval
            if (checkCounter <= 0) {
                checkTaskCompleted();
            }
            checkCounter -= 1
        }
        setCurrentTask();
        $('#objective-counter').text(checkCounter)
    });
});
