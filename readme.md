This is a demo app showing integration between Share.js (http://sharejs.org/) and Quill.js (http://quilljs.com/)

First of all run:
 
```npm install```
 
 to install this demo's dependencies.

The main issue I had with this integration was figuring out how to use the rich-text OT type on the browser side.
After a fair amount of trial and error, I hacked together a working front end version of the file which you will need to:

```
 copy from www/rich-text.js to node_modules/share/dist
```

The demo uses sharejs to deal with the editor changes, and a separate web socket to handle the cursor locations.
