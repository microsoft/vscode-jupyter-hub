# Configuration file for jupyterhub.

c = get_config()  #noqa
c.JupyterHub.authenticator_class = 'jupyterhub.auth.DummyAuthenticator'
c.DummyAuthenticator.password = "pwd"
c.Spawner.args = ['--NotebookApp.allow_origin=*']
c.Authenticator.admin_users = set(["donjayamanne"])
from jupyterhub.spawner import SimpleLocalProcessSpawner
c.JupyterHub.spawner_class = SimpleLocalProcessSpawner
