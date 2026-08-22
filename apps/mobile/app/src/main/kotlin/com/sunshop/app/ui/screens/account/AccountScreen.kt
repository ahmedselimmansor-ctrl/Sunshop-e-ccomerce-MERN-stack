package com.sunshop.app.ui.screens.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.sunshop.app.R
import com.sunshop.app.ui.theme.ThemePreference

@Composable
fun AccountScreen(viewModel: AccountViewModel = hiltViewModel()) {
    val user by viewModel.user.collectAsStateWithLifecycle()
    val theme by viewModel.theme.collectAsStateWithLifecycle(ThemePreference.SYSTEM)
    val error by viewModel.error.collectAsStateWithLifecycle()

    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (user == null) {
            Text(stringResource(R.string.action_sign_in), style = MaterialTheme.typography.titleLarge)

            error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            }

            OutlinedTextField(
                value = email,
                onValueChange = { email = it },
                label = { Text(stringResource(R.string.label_email)) },
                singleLine = true,
                modifier = Modifier.fillMaxWidth(),
            )
            OutlinedTextField(
                value = password,
                onValueChange = { password = it },
                label = { Text(stringResource(R.string.label_password)) },
                singleLine = true,
                visualTransformation = PasswordVisualTransformation(),
                modifier = Modifier.fillMaxWidth(),
            )
            Button(
                onClick = { viewModel.login(email, password) },
                modifier = Modifier.fillMaxWidth(),
            ) { Text(stringResource(R.string.action_sign_in)) }
        } else {
            Text("${user!!.firstName} ${user!!.lastName}", style = MaterialTheme.typography.titleLarge)
            Text(user!!.email, style = MaterialTheme.typography.bodyMedium)

            OutlinedButton(onClick = viewModel::logout, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.action_sign_out))
            }
        }

        Text(stringResource(R.string.label_theme), style = MaterialTheme.typography.labelLarge)

        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            ThemePreference.entries.forEachIndexed { index, preference ->
                SegmentedButton(
                    selected = theme == preference,
                    onClick = { viewModel.setTheme(preference) },
                    shape = SegmentedButtonDefaults.itemShape(index, ThemePreference.entries.size),
                ) {
                    Text(preference.name.lowercase().replaceFirstChar { it.uppercase() })
                }
            }
        }
    }
}
