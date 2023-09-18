# Configuration file for jupyterhub.
# This is used in tests today, can also be used as is for testing puroposes
# python -m jupyterhub --config=build/jupyterhub_config.py


# On github actions, the following code fails with the error `OSError: [Errno 6] No such device or address`
# Usingnode.js on CI we can see the username is `runner`
username = 'donjayamanne' #os.getlogin()

c = get_config()  #noqa
c.JupyterHub.authenticator_class = 'jupyterhub.auth.DummyAuthenticator'
c.DummyAuthenticator.password = "pwd"
c.Spawner.args = ['--NotebookApp.allow_origin=*']
c.Authenticator.admin_users = set([username])

# Use for local testing
from jupyterhub.spawner import SimpleLocalProcessSpawner
c.JupyterHub.spawner_class = SimpleLocalProcessSpawner

# More bogus users
c.Authenticator.allowed_users = {'joe', 'bloe'}
# Map the bogus users to a real user, so that we can spawn the jupyter servers.
c.Authenticator.username_map = {'joe': username, 'bloe': username}
# c.JupyterHub.bind_url = 'http://localhost:8091'
# c.JupyterHub.hub_connect_url = 'http://localhost:8092'
origin = '*'
c.JupyterHub.tornado_settings = {
    'headers': {
      'Access-Control-Allow-Origin': origin,
   },
}
c.NotebookApp.allow_origin = '*'
c.ServerApp.allow_origin = '*'
c.Spawner.args = ['--ServerApp.allow_remote_accessBool=True','--ServerApp.disable_check_xsrfBool=True','--ServerApp.allow_origin={0}'.format(origin), '--ServerApp.allow_origin_pat=.*']
