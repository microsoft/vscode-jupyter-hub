# JupyterHub Extension for Visual Studio Code

A [Visual Studio Code](https://code.visualstudio.com/) [extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter) that integrates with the Jupyter Extension allowing user to connect and execute code against kernels running on [JupyterHub](https://jupyter.org/hub).

### Quick Start
-   **Step 1.** Install [VS Code](https://code.visualstudio.com/)
-   **Step 2.** Install the [JupyterHub Extension](https://marketplace.visualstudio.com/items?itemName=ms-toolsai.jupyter-hub)
-   **Step 3.** Open or create a notebook file by opening the Command Palette (`Ctrl+Shift+P`) and select `Jupyter: Create New Jupyter Notebook`.
-   **Step 4.** Open the kernel picker by clicking on the kernel picker in the top right of the notebook or by invoking the `Notebook: Select Notebook Kernel` command
-   Select the option `Existing JupyterHub Server...`
-   Follow the prompts to enter the Url of the JupyterHub Server, username and password (or an [API token](https://github.com/microsoft/vscode-jupyter-hub/wiki/Logging-in-with-Username-and-API-token)).
-   Next select a Kernel and start coding!

![jupyterHubPreview](https://github.com/microsoft/vscode-jupyter-hub/assets/1948812/0fadd80c-3455-4408-8be9-8c6441809654)

> [!WARNING]
> Currently, opening a notebook in VS Code with a JupyterHub kernel will result in an incorrectly set working directory ([issue](https://github.com/microsoft/vscode-jupyter-hub/issues/49)).
This can cause issues with relative file paths and imports.
To avoid this problem, it's recommended to use this at the start of your notebook `import os; os.chdir('/folder/where/notebook/lives')`.

## Questions, issues, feature requests, and contributions

-   If you have a question about how to accomplish something with the extension, please [ask on Discussions](https://github.com/microsoft/vscode-jupyter/discussions). -   Any and all feedback is appreciated and welcome! If you come across a problem or bug with the extension, please [file an issue](https://github.com/microsoft/vscode-jupyter-hub/issues/new).
    -   If someone has already [filed an issue](https://github.com/Microsoft/vscode-jupyter-hub/issues) that encompasses your feedback, please leave a 👍/👎 reaction on the issue.

-   Contributions are always welcome, so please see our [contributing guide](https://github.com/Microsoft/vscode-jupyter-hub/blob/main/CONTRIBUTING.md) for more details.

## Data and telemetry

The Microsoft Jupyter Extension for Visual Studio Code collects usage data and sends it to Microsoft to help improve our products and services. Read our [privacy statement](https://privacy.microsoft.com/privacystatement) to learn more. This extension respects the `telemetry.telemetryLevel` setting which you can learn more about at https://code.visualstudio.com/docs/supporting/faq#_how-to-disable-telemetry-reporting.

## Trademarks

This project may contain trademarks or logos for projects, products, or services. Authorized use of Microsoft
trademarks or logos is subject to and must follow
[Microsoft's Trademark & Brand Guidelines](https://www.microsoft.com/en-us/legal/intellectualproperty/trademarks/usage/general).
Use of Microsoft trademarks or logos in modified versions of this project must not cause confusion or imply Microsoft sponsorship.
Any use of third-party trademarks or logos are subject to those third-party's policies.
