# Contributing to the JupyterHub extension for Visual Studio Code

---

| `main` branch |
| ------------- |

## | ![Main Build](https://github.com/microsoft/vscode-jupyter-hub/actions/workflows/build-test.yml/badge.svg?branch=main)

## Contributing a pull request

### Prerequisites

1. [Node.js](https://nodejs.org/) v20.18.2
2. [npm](https://www.npmjs.com/) 10.8.2
3. [Python](https://www.python.org/) 3.8 or later
4. Windows, macOS, or Linux
5. [Visual Studio Code](https://code.visualstudio.com/)
6. The following VS Code extensions:
    - [ESLint](https://marketplace.visualstudio.com/items?itemName=dbaeumer.vscode-eslint)
    - [Prettier](https://marketplace.visualstudio.com/items?itemName=esbenp.prettier-vscode)
    - [EditorConfig for VS Code](https://marketplace.visualstudio.com/items?itemName=EditorConfig.EditorConfig)
    - [Python Extension Code](https://marketplace.visualstudio.com/items?itemName=ms-python.python)
    - [Jupyter Extension for VS Code](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter)
    - [TypeScript + Webpack Problem Matchers](https://marketplace.visualstudio.com/items?itemName=amodio.tsl-problem-matcher)

### Setup

```shell
git clone https://github.com/microsoft/vscode-jupyter-hub
cd vscode-jupyter-hub
npm ci
```

### Incremental Builds

* Run `npm run esbuild-node-watch` for desktop version of extension
* Run `npm run esbuild-web-watch` for desktop version of extension
* Run `npm run test-compile-watch` for compilation of tests for the desktop as well as some scripts required for Web Tests
* Run `npm run test-compile-wepack-watch` for compilation of tests for the web

### Errors and Warnings

TypeScript errors and warnings will be displayed in the `Problems` window of Visual Studio Code.
Best to use the command `npm run test-compile-watch` to get `Problems` showing up in the `Problems` window.

### Run dev build and validate your changes

To test changes, open the `vscode-jupyter` folder in VSCode, and select the workspace titled `vscode-jupyter`.
Then, open the debug panel by clicking the `Run and Debug` icon on the sidebar, select the `Extension`
option from the top menu, and click start. A new window will launch with the title
`[Extension Development Host]`.

### Running Desktop Tests

* Setup and start Jupyter Hub locally
    * Update the `./build/jupyterhub_config.py` to replace `runner` with the username of the current computer
    * Launch JupyterHub via the CLI `python -m jupyterhub --config <fully qualified path to Jupyter Hub repo>/build/jupyterhub_config.py`
    * Verify Jupyter Hub is running and listening at `http://localhost:8000`
* Run the script `npm run esbuild-node-watch`
* Run the script `npm run test-compile-watch`
* From within VS Code run the launch option `Tests`


### Running Web Tests

* Setup and start Jupyter Hub locally
    * Update the `./build/jupyterhub_config.py` to replace `runner` with the username of the current computer
    * Launch JupyterHub via the CLI `python -m jupyterhub --config <fully qualified path to Jupyter Hub repo>/build/jupyterhub_config.py`
    * Verify Jupyter Hub is running and listening at `http://localhost:8000`
* Run the script `npm run esbuild-web-watch`
* Run the script `npm run test-compile-watch`
* Run the script `npm run test-compile-webpack-watch`
* From the terminal run the command `npm run test:web`

### Standard Debugging

Clone the repo into any directory, open that directory in VSCode, and use the `Build and launch` launch option within VSCode.

### Coding Standards

Information on our coding standards can be found [here](https://github.com/Microsoft/vscode-jupyter/blob/main/CODING_STANDARDS.md).
We have CI tests to ensure the code committed will adhere to the above coding standards.
