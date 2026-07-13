# Grayson's Wishlist


## Theming
* color picker for accent, maybe option for slight hue shift for background color. Light/dark variants.
* Optional presets for matching model providor branding (Anthropic, OpenAI, Google)

## Archiving
* Figure out how sessions are arhcived. Can currently see one archived project, but where is button to place there?
edit: found it, nested in "Delete" men. unintuitive. maybe add long-hold press or side button to convo for pop-up listing Rename, Archive and Delete

## Fixes
* Sidebar: Condense bottom 3 bottoms (Report, Join Community, Settings) to one row, free up space for convo list)
* Top 'Projects' and 'Conversations' tabs do nothing when selected.
* Model selector: Currently states * Sonnet 4.6 is default - outdated, sonnet 5 is now default.
* Convo window text box: remove counter for number of available commands. Also, make it so when tapping this button on mobile to not activate keyboard flyout? 
* "Thinking" text contained in box attached to text box, looks awkward as it reaizes with the changing thinking text. 
* Convo window: Two "Stop" buttons can be present in a convo - redundent, just keep the one in text box.
* Convo window Top bar (mobile): Plugin buttons cramp Conversation title when multiple plugins are present. Remove convo title? move Plugin toolbar underneath? Or consolidate plugins into one menu activated by a button? Tools like Shell and Files too important to hide in plugin menu next to Stats tracker and session tracker plugins.
maybe place Convo, Files and Shell in bottom navbar, single keep plugin button/dropdown at top.
* Convo window: Mode selector (Auto, Accept, Bypass, Plan) Are distinguinshed only by colour on mobile ui. consider unicode characters, and/or list all modes in flyout menu when long-pressed to see all modes (mobile).
* Convo window: bug - clicking mode selector on desktop shifts ui and buttons in message box.
* No option to change model mid convo - only at beginning of convo. add somewhere?
* File Editor: Typing long enough lines that reach the edge of the screen will not text wrap, rather, continue pushing the leftmost edge into the conversationg box and  squiching it to become more narrow. (sometimes?)
* General condensing/reducing size of ui elements and popup menus for mobile - some assets hidden due to size.
* Sometimes session names in CloudCLI sidebar do not match names listed in terminal when using Claude /resume

## Wishlist
* True session syncing? Useing Claudw Code directly does not list CloudCli conversations.
* Conversation Window: A "map" sidebar that shows a visual of where the user and claude messaged in the conversation (like you see in doc editors/IDEs) - tapping scrolls to that part of the convo
* Convo Window: double tappign Esc to stop sending of message and immediately begin editing it.
/rewind command
* Find what commands in the Claude Code CLI are missing from CloudCLI, integrate them.
* More modern features that IDE's offer, like "@"ing files, highlighting text in text editor for reference